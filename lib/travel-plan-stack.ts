import * as fs from 'fs';
import * as path from 'path';
import { Construct } from 'constructs';
import {
  aws_apigatewayv2 as apigateway,
  aws_apigatewayv2_authorizers as authorizers,
  aws_apigatewayv2_integrations as integrations,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_route53 as route53,
  aws_route53_targets as targets,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  aws_ssm as ssm,
  CfnOutput,
  CfnResource,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import apiRoutes from '../lambda/api/routes.json';
import { versionAssets } from './asset-version';

const ROOT = path.join(__dirname, '..');
const LOG_RETENTION = logs.RetentionDays.THREE_MONTHS;

export const PARAMETER_PREFIX = '/travel-plan';
// Shared by every dliu.com app, owned by the dliu-com/audit stack: the Entra tenant and the shared "dliu API" app ID.
export const TENANT_PARAMETER = '/dliu/entra-tenant-id';
export const API_APP_PARAMETER = '/dliu/api-app-id';
/** Managed API stage throttling, requests per second and burst, shared by every caller. */
export const MANAGED_API_RATE = 10;
export const MANAGED_API_BURST = 20;

// Serves the single-page app for trip pages (/plan/<id>) and old links (/trips/<id>, /s/<token>).
// Link-preview bots (WhatsApp, iMessage, Telegram, Slack, Teams…) get a bare page with the
// title and no images, so chats show a plain link instead of a big icon card.
export const PREVIEW_BOTS = /WhatsApp|facebookexternalhit|Facebot|Twitterbot|TelegramBot|Slackbot|LinkedInBot|Discordbot|SkypeUriPreview|redditbot|Pinterest|vkShare|Viber/i;
// Docs: /docs (architecture, and the API and Testing tabs at /docs#api and /docs#health), /docs/cost and /docs/security
// are app-shell pages. The old /about, /security, /docs/api and /docs/health addresses move there for good (301),
// keeping any query string (placed before a #fragment). /docs/api.md is a different path and is served as is.
export const DOCS_MOVED: Record<string, string> = { '/about': '/docs', '/security': '/docs/security', '/docs/api': '/docs#api', '/docs/health': '/docs#health' };
export const REWRITE_FUNCTION_CODE = `function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var path = uri.length > 1 ? uri.replace(/\\/$/, '') : uri;
  var moved = ${JSON.stringify(DOCS_MOVED)};
  if (moved[path]) {
    var query = [];
    var qs = request.querystring || {};
    for (var key in qs) {
      var values = qs[key].multiValue || [qs[key]];
      for (var i = 0; i < values.length; i++) query.push(key + '=' + values[i].value);
    }
    var target = moved[path];
    var hash = target.indexOf('#');
    var base = hash < 0 ? target : target.substring(0, hash);
    var fragment = hash < 0 ? '' : target.substring(hash);
    return { statusCode: 301, statusDescription: 'Moved Permanently',
      headers: { location: { value: base + (query.length ? '?' + query.join('&') : '') + fragment }, 'cache-control': { value: 'max-age=86400' } } };
  }
  var page = uri === '/' || uri === '/index.html' || uri.indexOf('/plan/') === 0 || uri.indexOf('/trips/') === 0 || uri.indexOf('/s/') === 0
    || path === '/docs' || path === '/docs/cost' || path === '/docs/security';
  var agent = request.headers && request.headers['user-agent'] ? request.headers['user-agent'].value : '';
  if (page && ${PREVIEW_BOTS}.test(agent)) {
    return {
      statusCode: 200,
      statusDescription: 'OK',
      headers: { 'content-type': { value: 'text/html; charset=utf-8' }, 'cache-control': { value: 'no-store' } },
      body: '<!doctype html><html><head><meta charset="utf-8"><title>DL Travel Plan</title>'
        + '<meta property="og:title" content="DL Travel Plan"><meta property="og:site_name" content="DL Travel Plan"></head><body></body></html>',
    };
  }
  if (page && uri !== '/') request.uri = '/index.html';
  return request;
}`;

// JSON logs without Lambda's START/END/REPORT lines for every call, so a flood of refused requests
// doesn't also pay for log ingestion. Warnings and errors from the code are still logged.
const QUIET_LOGS = {
  loggingFormat: lambda.LoggingFormat.JSON,
  systemLogLevelV2: lambda.SystemLogLevel.WARN,
  applicationLogLevelV2: lambda.ApplicationLogLevel.INFO,
};

export interface TravelPlanStackProps extends StackProps {
  /** Subdomain under the MainDomain export. */
  subdomain?: string;
  /** Send CloudFront logs to the TrafficMonitor stack (needs its exports). */
  trafficLogging?: boolean;
  /**
   * Managed API for Microsoft-issued access tokens (shared dliu API, trip.* scopes) on API Gateway.
   * Reads the shared SSM parameters /dliu/entra-tenant-id and /dliu/api-app-id at deploy time. Off by default.
   */
  microsoftApi?: boolean;
}

// The agent-readable API docs, with the managed API's URL filled in at deploy time.
export const API_DOCS = 'docs/api.md';
// How status.dliu.com tests the site, for machines (the people's version is the Testing tab, /docs#health).
export const HEALTH_DOCS = 'docs/health.md';
export const MARKDOWN = 'docs/*.md';
// The HTML shell (index.html) is never edge-cached for long; everything else under web/ is.
export const SITE_PAGES = '*.html';
export const STATIC_CACHE_CONTROL = ['public', 'max-age=300', 's-maxage=86400', 'stale-while-revalidate=86400'];
export const API_URL_MARKER = '__TRIP_API_URL__';

export class TravelPlanStack extends Stack {
  constructor(scope: Construct, id: string, props: TravelPlanStackProps = {}) {
    super(scope, id, props);

    const subdomain = props.subdomain ?? 'plan';
    const rootDomain = Fn.importValue('MainDomain');
    const domainName = Fn.join('', [`${subdomain}.`, rootDomain]);
    const siteUrl = Fn.join('', ['https://', domainName]);
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ImportedHostedZone', {
      zoneName: rootDomain,
      hostedZoneId: Fn.importValue('MainHostedZoneId'),
    });

    // ---------- Data ----------
    const table = new dynamodb.TableV2(this, 'Trips', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      globalSecondaryIndexes: [{
        indexName: 'byShareToken',
        partitionKey: { name: 'shareToken', type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.KEYS_ONLY,
      }],
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Daily usage counters for share-link guests (lambda/api/limits.js). Rows expire via TTL; nothing worth keeping.
    const limitsTable = new dynamodb.TableV2(this, 'Limits', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Attachments: private, uploaded and downloaded with presigned URLs from the API.
    // Uploads land in pending/ and are moved to trips/<id>/ once confirmed; abandoned ones expire.
    const filesBucket = new s3.Bucket(this, 'FilesBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      removalPolicy: RemovalPolicy.RETAIN,
      cors: [{
        allowedMethods: [s3.HttpMethods.PUT],
        allowedOrigins: [siteUrl],
        allowedHeaders: ['content-type'],
        maxAge: 3600,
      }],
      lifecycleRules: [
        { id: 'expire-pending-uploads', prefix: 'pending/', expiration: Duration.days(1) },
        { id: 'abort-multipart', abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
    });

    // ---------- API ----------
    const apiHandler = new lambda.Function(this, 'ApiHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(ROOT, 'lambda/api')),
      timeout: Duration.seconds(15),
      memorySize: 512,
      // The account's Lambda concurrency is shared with the other dliu.com sites; a flood here can't take it all.
      reservedConcurrentExecutions: 20,
      description: 'plan.dliu.com trips API and Microsoft Entra sign-in',
      environment: {
        SITE_URL: siteUrl,
        ROOT_DOMAIN: rootDomain,
        TABLE_NAME: table.tableName,
        LIMITS_TABLE: limitsTable.tableName,
        FILES_BUCKET: filesBucket.bucketName,
        PARAMETER_PREFIX,
        TENANT_PARAMETER,
      },
      ...QUIET_LOGS,
      logGroup: new logs.LogGroup(this, 'ApiLogs', {
        retention: LOG_RETENTION,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    table.grantReadWriteData(apiHandler);
    limitsTable.grantReadWriteData(apiHandler);
    filesBucket.grantReadWrite(apiHandler);
    filesBucket.grantDelete(apiHandler);
    // Both functions read the sign-in settings from SSM: this app's client ID and secret (the session key) and the
    // shared tenant ID. The managed API's tenant and app ID are resolved at deploy time, so they aren't granted here.
    const parameterArn = (name: string) => this.formatArn({ service: 'ssm', resource: 'parameter', resourceName: name.slice(1) });
    const readSecrets = (fn: lambda.Function) => {
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['ssm:GetParameters'],
        resources: [parameterArn(`${PARAMETER_PREFIX}/*`), parameterArn(TENANT_PARAMETER)],
      }));
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: ['*'],
        conditions: { StringEquals: { 'kms:ViaService': `ssm.${this.region}.amazonaws.com` } },
      }));
    };
    readSecrets(apiHandler);

    const functionUrl = apiHandler.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });

    // PDF export: lays out a plan with pdfkit and an embedded CJK font. Reuses the API's access checks,
    // so the asset is lambda/ (api/ + pdf/). Read-only on the trips table (it only writes guests' usage counters); no access to the attachments bucket.
    const pdfHandler = new lambda.Function(this, 'PdfHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'pdf/index.handler',
      code: lambda.Code.fromAsset(path.join(ROOT, 'lambda'), { exclude: ['pdf/package-lock.json', '**/*.md'] }),
      timeout: Duration.seconds(30),
      memorySize: 1024,
      reservedConcurrentExecutions: 5,
      description: 'plan.dliu.com travel plan PDF export',
      environment: {
        SITE_URL: siteUrl,
        ROOT_DOMAIN: rootDomain,
        TABLE_NAME: table.tableName,
        LIMITS_TABLE: limitsTable.tableName,
        PARAMETER_PREFIX,
        TENANT_PARAMETER,
      },
      ...QUIET_LOGS,
      logGroup: new logs.LogGroup(this, 'PdfLogs', {
        retention: LOG_RETENTION,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    table.grantReadData(pdfHandler);
    limitsTable.grantWriteData(pdfHandler);
    readSecrets(pdfHandler);
    const pdfUrl = pdfHandler.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });

    // ---------- Managed API (Microsoft access tokens) ----------
    // API Gateway checks the token (signature, issuer, audience, expiry, route scope); the functions re-check the
    // claims (lambda/api/api-access.js). The website, its sign-in cookie and share links don't use this API.
    let managedApiUrl: string | undefined;
    if (props.microsoftApi) {
      const tenantId = ssm.StringParameter.valueForStringParameter(this, TENANT_PARAMETER);
      // The shared "dliu API" app: tokens are issued for it (audience) and through it (azp).
      const apiAppId = ssm.StringParameter.valueForStringParameter(this, API_APP_PARAMETER);
      const audience = apiAppId;
      const clientId = apiAppId;
      const httpApi = new apigateway.HttpApi(this, 'MicrosoftApi', {
        description: 'Travel plan API: Microsoft Entra access tokens, delegated trip.* permissions and assigned users',
      });
      // Caps token-bearing traffic (only tokens from the configured tenant pass the authorizer): above this API Gateway
      // answers 429 before Lambda runs. Requests without a valid token get 401 from the authorizer first and never reach Lambda.
      (httpApi.defaultStage!.node.defaultChild as apigateway.CfnStage).defaultRouteSettings = {
        throttlingRateLimit: MANAGED_API_RATE, throttlingBurstLimit: MANAGED_API_BURST,
      };
      const authorizer = new authorizers.HttpJwtAuthorizer('MicrosoftJwt',
        Fn.join('', ['https://login.microsoftonline.com/', tenantId, '/v2.0']), { jwtAudience: [audience] });
      const apiIntegration = new integrations.HttpLambdaIntegration('TripApi', apiHandler);
      const pdfIntegration = new integrations.HttpLambdaIntegration('TripPdf', pdfHandler);
      for (const [route, permission] of Object.entries(apiRoutes) as [string, { scope: string; function?: string }][]) {
        const [method, routePath] = route.split(' ');
        httpApi.addRoutes({
          path: routePath,
          methods: [apigateway.HttpMethod[method as 'GET' | 'POST' | 'PUT' | 'DELETE']],
          integration: permission.function === 'pdf' ? pdfIntegration : apiIntegration,
          authorizer,
          authorizationScopes: [permission.scope],
        });
      }
      for (const fn of [apiHandler, pdfHandler]) {
        fn.addEnvironment('API_GATEWAY_ID', httpApi.apiId);
        fn.addEnvironment('API_TENANT_ID', tenantId);
        fn.addEnvironment('API_AUDIENCE', audience);
        fn.addEnvironment('API_CLIENT_ID', clientId);
      }
      managedApiUrl = httpApi.apiEndpoint;
      new CfnOutput(this, 'MicrosoftApiUrl', { value: httpApi.apiEndpoint });
    }

    // ---------- Website ----------
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront requires its certificate in us-east-1 (same pattern as the other sites).
    const certificate = new acm.DnsValidatedCertificate(this, 'SiteCertificate', {
      domainName,
      hostedZone,
      region: 'us-east-1',
    });

    const headers = new cloudfront.ResponseHeadersPolicy(this, 'SiteHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          // Images and uploads go straight to the attachments bucket. The shared dliu.com look
          // (dl.css, dl-docs.css and the footer DL logo) comes from files.dliu.com/dliu.com/ only.
          contentSecurityPolicy: Fn.join('', [
            "default-src 'self'; script-src 'self'; style-src 'self' https://files.dliu.com/dliu.com/ui/; object-src 'none'; ",
            'img-src \'self\' data: blob: https://files.dliu.com/dliu.com/ https://', filesBucket.bucketRegionalDomainName, '; ',
            'connect-src \'self\' https://', filesBucket.bucketRegionalDomainName, '; ',
            "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          ]),
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: false, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: 'X-Robots-Tag', value: 'noindex, nofollow', override: true },
          { header: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()', override: true },
        ],
      },
    });

    const rewrite = new cloudfront.Function(this, 'TripPathRewrite', {
      comment: 'Serve index.html for /plan/<id> and old /trips/, /s/ links',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(REWRITE_FUNCTION_CODE),
    });

    const functionAssociations: cloudfront.FunctionAssociation[] = [
      { eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: rewrite },
    ];
    const trafficLogging = props.trafficLogging ?? true;
    // Makes CloudFront add CloudFront-Viewer-City so the visitor function can log the city.
    const trafficGeoPolicy = trafficLogging
      ? cloudfront.OriginRequestPolicy.fromOriginRequestPolicyId(this, 'TrafficGeo', Fn.importValue('TrafficGeoOriginRequestPolicyId'))
      : undefined;
    if (trafficLogging) {
      functionAssociations.push({
        eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
        function: cloudfront.Function.fromFunctionAttributes(this, 'VisitorId', {
          functionArn: Fn.importValue('TrafficVisitorFunctionArn'),
          functionName: 'dliu-visitor-id',
        }),
      });
    }

    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: origins.FunctionUrlOrigin.withOriginAccessControl(functionUrl, { readTimeout: Duration.seconds(15) }),
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      responseHeadersPolicy: headers,
    };

    // status.dliu.com's /health: no origin request policy, so CloudFront forwards no cookies, Authorization header or
    // query string, and the cache key is empty, so the Lambda runs at most about once a minute per edge.
    const healthCache = new cloudfront.CachePolicy(this, 'HealthCache', {
      comment: 'plan.dliu.com /health: keyed on nothing, 60 s',
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.seconds(60),
      maxTtl: Duration.seconds(60),
    });
    const healthBehavior: cloudfront.BehaviorOptions = {
      origin: apiBehavior.origin,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: healthCache,
      responseHeadersPolicy: headers,
    };

    const pdfBehavior: cloudfront.BehaviorOptions = {
      ...apiBehavior,
      origin: origins.FunctionUrlOrigin.withOriginAccessControl(pdfUrl, { readTimeout: Duration.seconds(30) }),
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
    };

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      comment: 'plan.dliu.com',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        originRequestPolicy: trafficGeoPolicy,
        responseHeadersPolicy: headers,
        compress: true,
        functionAssociations,
      },
      // Listed first so it wins over api/*.
      additionalBehaviors: {
        'api/trips/*/pdf': pdfBehavior,
        'api/*': apiBehavior,
        'auth/*': apiBehavior,
        'health': healthBehavior,
      },
      domainNames: [domainName],
      certificate,
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      // Most visitors are in Europe and Asia, so serve from every edge location.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });
    if (trafficLogging) {
      // TrafficMonitor delivers this distribution's access logs (CloudFront standard logging v2).
      // IncludeCookies is the only legacy logging setting v2 honours: it puts the dl_vid cookie in the logs.
      (distribution.node.defaultChild as cloudfront.CfnDistribution)
        .addPropertyOverride('DistributionConfig.Logging', { IncludeCookies: true });
    }

    // New function URLs require both invoke permissions. CDK adds InvokeFunctionUrl.
    for (const fn of [apiHandler, pdfHandler]) {
      fn.addPermission('CloudFrontInvokeFunction', {
        principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
        action: 'lambda:InvokeFunction',
        sourceArn: distribution.distributionArn,
        invokedViaFunctionUrl: true,
      });
    }

    const apiDocs = fs.readFileSync(path.join(ROOT, 'web', API_DOCS), 'utf8')
      .split(API_URL_MARKER).join(managedApiUrl ?? '(not enabled in this deployment)');
    const healthDocs = fs.readFileSync(path.join(ROOT, 'web', HEALTH_DOCS), 'utf8');
    // Scripts, styles, the icon and the Markdown docs are public and the same for everyone, and every
    // deploy invalidates the whole distribution, so the edge keeps them for a day. Each deployment
    // excludes the other's files, so neither prunes them.
    const siteAssets = new s3deploy.BucketDeployment(this, 'SiteContent', {
      sources: [s3deploy.Source.asset(path.join(ROOT, 'web'), { exclude: [MARKDOWN] })],
      destinationBucket: siteBucket,
      exclude: [SITE_PAGES, MARKDOWN],
      distribution,
      distributionPaths: ['/*'],
      cacheControl: STATIC_CACHE_CONTROL.map((directive) => s3deploy.CacheControl.fromString(directive)),
    });
    // The HTML shell stays no-cache: browsers revalidate (cheap 304s) so a deploy takes effect on the next load,
    // and its script and style URLs carry a content hash, so it never runs with an older cached script.
    const webDir = path.join(ROOT, 'web');
    new s3deploy.BucketDeployment(this, 'SitePages', {
      sources: [s3deploy.Source.data('index.html', versionAssets(fs.readFileSync(path.join(webDir, 'index.html'), 'utf8'), webDir))],
      destinationBucket: siteBucket,
      exclude: ['*'],
      include: [SITE_PAGES],
      distribution,
      distributionPaths: ['/*'],
      cacheControl: [s3deploy.CacheControl.noCache()],
    }).node.addDependency(siteAssets);
    // The Markdown docs, served as text/markdown; charset=utf-8 (the contract for /docs/health.md).
    new s3deploy.BucketDeployment(this, 'SiteMarkdown', {
      sources: [s3deploy.Source.data(API_DOCS, apiDocs), s3deploy.Source.data(HEALTH_DOCS, healthDocs)],
      destinationBucket: siteBucket,
      exclude: ['*'],
      include: [MARKDOWN],
      distribution,
      distributionPaths: ['/*'],
      contentType: 'text/markdown; charset=utf-8',
      cacheControl: STATIC_CACHE_CONTROL.map((directive) => s3deploy.CacheControl.fromString(directive)),
    }).node.addDependency(siteAssets);

    new route53.ARecord(this, 'SiteAliasRecord', {
      recordName: subdomain,
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });
    new route53.AaaaRecord(this, 'SiteAliasIpv6Record', {
      recordName: subdomain,
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    new CfnOutput(this, 'SiteUrl', { value: siteUrl });
    new CfnOutput(this, 'AuthRedirectUri', { value: Fn.join('', [siteUrl, '/auth/callback']) });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'FilesBucketName', { value: filesBucket.bucketName });
    new CfnOutput(this, 'ApiFunctionName', { value: apiHandler.functionName });
    new CfnOutput(this, 'PdfFunctionName', { value: pdfHandler.functionName });

    this.keepHelperLogs();
  }

  // CDK's own helper Lambdas (bucket deployment, auto-delete, certificate requestor) would otherwise log to
  // auto-created groups that never expire, so each gets a stack-managed group with the same retention.
  private keepHelperLogs() {
    const functions = this.node.findAll().filter((c): c is CfnResource =>
      c instanceof CfnResource && c.cfnResourceType === 'AWS::Lambda::Function');
    for (const fn of functions) {
      if (fn instanceof lambda.CfnFunction && (fn.loggingConfig as lambda.CfnFunction.LoggingConfigProperty | undefined)?.logGroup) continue;
      const group = new logs.LogGroup(this, `${fn.node.path.split('/').slice(1).join('')}Logs`, {
        retention: LOG_RETENTION,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      fn.addPropertyOverride('LoggingConfig.LogGroup', group.logGroupName);
      fn.node.addDependency(group);
    }
  }
}
