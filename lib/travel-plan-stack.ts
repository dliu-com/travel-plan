import * as path from 'path';
import { Construct } from 'constructs';
import {
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
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  StackProps,
} from 'aws-cdk-lib';

const ROOT = path.join(__dirname, '..');

export const PARAMETER_PREFIX = '/travel-plan';
export const TRAFFIC_SITE_KEY = 'plan';

// Serves the single-page app for trip pages (/trips/<id>) and share links (/s/<token>).
export const REWRITE_FUNCTION_CODE = `function handler(event) {
  var request = event.request;
  if (request.uri.indexOf('/trips/') === 0 || request.uri.indexOf('/s/') === 0) request.uri = '/index.html';
  return request;
}`;

export interface TravelPlanStackProps extends StackProps {
  /** Subdomain under the MainDomain export. */
  subdomain?: string;
  /** Send CloudFront logs to the TrafficMonitor stack (needs its exports). */
  trafficLogging?: boolean;
}

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

    // ---------- API ----------
    const apiHandler = new lambda.Function(this, 'ApiHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(ROOT, 'lambda/api')),
      timeout: Duration.seconds(15),
      memorySize: 512,
      description: 'plan.dliu.com trips API and Microsoft Entra sign-in',
      environment: {
        SITE_URL: siteUrl,
        ROOT_DOMAIN: rootDomain,
        TABLE_NAME: table.tableName,
        PARAMETER_PREFIX,
      },
      logGroup: new logs.LogGroup(this, 'ApiLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    table.grantReadWriteData(apiHandler);
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameters'],
      resources: [this.formatArn({ service: 'ssm', resource: 'parameter', resourceName: PARAMETER_PREFIX.slice(1) + '/*' })],
    }));
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt'],
      resources: ['*'],
      conditions: { StringEquals: { 'kms:ViaService': `ssm.${this.region}.amazonaws.com` } },
    }));

    const functionUrl = apiHandler.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });

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
          contentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://files.dliu.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: false, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [{ header: 'X-Robots-Tag', value: 'noindex, nofollow', override: true }],
      },
    });

    const rewrite = new cloudfront.Function(this, 'TripPathRewrite', {
      comment: 'Serve index.html for /trips/<id> and /s/<token>',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(REWRITE_FUNCTION_CODE),
    });

    const functionAssociations: cloudfront.FunctionAssociation[] = [
      { eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: rewrite },
    ];
    let logging: Partial<cloudfront.DistributionProps> = {};
    if (props.trafficLogging ?? true) {
      functionAssociations.push({
        eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
        function: cloudfront.Function.fromFunctionAttributes(this, 'VisitorId', {
          functionArn: Fn.importValue('TrafficVisitorFunctionArn'),
          functionName: 'dliu-visitor-id',
        }),
      });
      logging = {
        enableLogging: true,
        logBucket: s3.Bucket.fromBucketAttributes(this, 'TrafficLogs', {
          bucketName: Fn.importValue('TrafficLogBucketName'),
          region: 'eu-west-1',
        }),
        logFilePrefix: `raw/${TRAFFIC_SITE_KEY}/`,
        logIncludesCookies: true,
      };
    }

    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: origins.FunctionUrlOrigin.withOriginAccessControl(functionUrl, { readTimeout: Duration.seconds(15) }),
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      responseHeadersPolicy: headers,
    };

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      comment: 'plan.dliu.com',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
        compress: true,
        functionAssociations,
      },
      additionalBehaviors: {
        'api/*': apiBehavior,
        'auth/*': apiBehavior,
      },
      domainNames: [domainName],
      certificate,
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      ...logging,
    });

    // New function URLs require both invoke permissions. CDK adds InvokeFunctionUrl.
    apiHandler.addPermission('CloudFrontInvokeFunction', {
      principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: distribution.distributionArn,
      invokedViaFunctionUrl: true,
    });

    new s3deploy.BucketDeployment(this, 'SiteContent', {
      sources: [s3deploy.Source.asset(path.join(ROOT, 'web'))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

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
    new CfnOutput(this, 'ApiFunctionName', { value: apiHandler.functionName });
  }
}
