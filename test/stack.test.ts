import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { REWRITE_FUNCTION_CODE, TravelPlanStack } from '../lib/travel-plan-stack';

const env = { account: '123456789012', region: 'eu-west-1' };
const template = Template.fromStack(new TravelPlanStack(new App(), 'TravelPlan', { env }));

test('trips table has a share-token index and is protected', () => {
  template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    GlobalSecondaryIndexes: [Match.objectLike({
      IndexName: 'byShareToken',
      KeySchema: [{ AttributeName: 'shareToken', KeyType: 'HASH' }],
      Projection: { ProjectionType: 'KEYS_ONLY' },
    })],
    Replicas: [Match.objectLike({
      DeletionProtectionEnabled: true,
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    })],
  });
  template.hasResource('AWS::DynamoDB::GlobalTable', { DeletionPolicy: 'Retain' });
});

test('share-link usage counters live in their own expiring table, used by both functions', () => {
  const [name] = Object.entries(template.findResources('AWS::DynamoDB::GlobalTable'))
    .find(([, r]: any) => r.Properties.TimeToLiveSpecification?.AttributeName === 'expiresAt') as any;
  for (const handler of ['index.handler', 'pdf/index.handler']) {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: handler,
      Environment: { Variables: Match.objectLike({ LIMITS_TABLE: { Ref: name } }) },
    });
  }
  template.hasResource('AWS::DynamoDB::GlobalTable', { DeletionPolicy: 'Delete' });
});

test('api can query the share index and read only its own parameters', () => {
  const statements = Object.values(template.findResources('AWS::IAM::Policy'))
    .flatMap((policy: any) => policy.Properties.PolicyDocument.Statement);
  const dynamo = statements.find((s: any) => ([] as string[]).concat(s.Action).includes('dynamodb:Query'));
  expect(JSON.stringify(dynamo.Resource)).toContain('/index/*');

  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([Match.objectLike({
        Action: 'ssm:GetParameters',
        Resource: { 'Fn::Join': ['', Match.arrayWith([Match.stringLikeRegexp(':parameter/travel-plan/\\*$')])] },
      })]),
    },
  });
});

test('api and auth paths go to the function URL with all methods and no caching', () => {
  const distribution = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0] as any;
  const behaviors = distribution.Properties.DistributionConfig.CacheBehaviors;
  expect(behaviors.map((b: any) => b.PathPattern)).toEqual(['api/trips/*/pdf', 'api/*', 'auth/*']);
  for (const behavior of behaviors.slice(1)) {
    expect(behavior.AllowedMethods).toEqual(expect.arrayContaining(['POST', 'PUT', 'DELETE']));
    expect(behavior.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
  }
  template.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'AWS_IAM' });
  template.hasResourceProperties('AWS::Lambda::Permission', {
    Action: 'lambda:InvokeFunction',
    Principal: 'cloudfront.amazonaws.com',
    InvokedViaFunctionUrl: true,
  });
});

test('PDF export is its own read-only function behind CloudFront, ahead of api/*', () => {
  const distribution = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0] as any;
  const [pdf, api] = distribution.Properties.DistributionConfig.CacheBehaviors;
  expect(pdf.PathPattern).toBe('api/trips/*/pdf');
  expect(pdf.AllowedMethods.sort()).toEqual(['GET', 'HEAD']);
  expect(pdf.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
  expect(pdf.TargetOriginId).not.toBe(api.TargetOriginId);
  template.hasResourceProperties('AWS::Lambda::Function', {
    Handler: 'pdf/index.handler',
    MemorySize: 1024,
    Timeout: 30,
    ReservedConcurrentExecutions: 5,
    Environment: { Variables: Match.objectLike({ TABLE_NAME: Match.anyValue() }) },
  });
  template.resourceCountIs('AWS::Lambda::Url', 2);
  const pdfFunction = Object.entries(template.findResources('AWS::Lambda::Function'))
    .find(([, r]: any) => r.Properties.Handler === 'pdf/index.handler') as any;
  expect(pdfFunction[1].Properties.Environment.Variables.FILES_BUCKET).toBeUndefined();
});

test('trip and share pages are rewritten to the app shell', () => {
  template.hasResourceProperties('AWS::CloudFront::Function', {
    FunctionConfig: Match.objectLike({ Runtime: 'cloudfront-js-2.0' }),
    FunctionCode: REWRITE_FUNCTION_CODE,
  });
  // eslint-disable-next-line no-new-func
  const handler = new Function(`${REWRITE_FUNCTION_CODE}; return handler;`)();
  const uri = (u: string) => handler({ request: { uri: u } }).uri;
  expect(uri('/plan/20261000')).toBe('/index.html');
  expect(uri('/trips/kyoto-abcdefghij')).toBe('/index.html');
  expect(uri('/s/AAAAAAAAAAAAAAAAAAAAAAAA')).toBe('/index.html');
  expect(uri('/about')).toBe('/index.html');
  expect(uri('/security/')).toBe('/index.html');
  expect(uri('/about.txt')).toBe('/about.txt');
  expect(uri('/app.js')).toBe('/app.js');
  expect(uri('/')).toBe('/');
});

test('link-preview bots get the title without any image', () => {
  // eslint-disable-next-line no-new-func
  const handler = new Function(`${REWRITE_FUNCTION_CODE}; return handler;`)();
  const visit = (uri: string, agent: string) => handler({ request: { uri, headers: { 'user-agent': { value: agent } } } });
  const card = visit('/plan/20261000', 'WhatsApp/2.23.20.0 A');
  expect(card.statusCode).toBe(200);
  expect(card.body).toContain('<title>DL Travel Plan</title>');
  expect(card.body).not.toMatch(/<img|og:image|rel="icon"/);
  expect(visit('/plan/20261000', 'facebookexternalhit/1.1 Facebot Twitterbot/1.0').statusCode).toBe(200);
  expect(visit('/plan/20261000', 'Mozilla/5.0 (Macintosh) Chrome/130').uri).toBe('/index.html');
  expect(visit('/icon.png', 'WhatsApp/2.23.20.0 A').uri).toBe('/icon.png');
});

test('the api cannot use up the shared account concurrency', () => {
  template.hasResourceProperties('AWS::Lambda::Function', { ReservedConcurrentExecutions: 20 });
});

test('access logs include cookies for the traffic monitor, without legacy log files', () => {
  const distribution = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0] as any;
  expect(distribution.Properties.DistributionConfig.Logging).toEqual({ IncludeCookies: true });
});

test('pages forward the viewer city so the visitor function can log it', () => {
  const distribution = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0] as any;
  expect(distribution.Properties.DistributionConfig.DefaultCacheBehavior.OriginRequestPolicyId)
    .toEqual({ 'Fn::ImportValue': 'TrafficGeoOriginRequestPolicyId' });
});

test('traffic logging can be turned off', () => {
  const quiet = Template.fromStack(new TravelPlanStack(new App(), 'Quiet', { env, trafficLogging: false }));
  const distribution = Object.values(quiet.findResources('AWS::CloudFront::Distribution'))[0] as any;
  expect(distribution.Properties.DistributionConfig.Logging).toBeUndefined();
  expect(distribution.Properties.DistributionConfig.DefaultCacheBehavior.OriginRequestPolicyId).toBeUndefined();
});

test('pages are not indexed and only load our own scripts', () => {
  template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
    ResponseHeadersPolicyConfig: Match.objectLike({
      CustomHeadersConfig: { Items: [
        Match.objectLike({ Header: 'X-Robots-Tag' }),
        Match.objectLike({ Header: 'Permissions-Policy', Value: Match.stringLikeRegexp('camera=\\(\\)') }),
      ] },
      SecurityHeadersConfig: Match.objectLike({
        ContentSecurityPolicy: Match.objectLike({ ContentSecurityPolicy: Match.anyValue() }),
      }),
    }),
  });
  const policy = Object.values(template.findResources('AWS::CloudFront::ResponseHeadersPolicy'))[0] as any;
  const csp = JSON.stringify(policy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy);
  expect(csp).toContain("script-src 'self';");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain('unsafe-inline');
  // Only the shared dliu.com stylesheets and DL icon, not the rest of files.dliu.com.
  expect(csp).toContain("style-src 'self' https://files.dliu.com/dliu.com/ui/;");
  expect(csp).toContain("img-src 'self' data: blob: https://files.dliu.com/dliu.com/ https://");
  expect(csp).not.toMatch(/https:\/\/files\.dliu\.com[ ;]/);
});

test('attachments live in a private bucket that only accepts uploads from the site', () => {
  template.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    CorsConfiguration: { CorsRules: [Match.objectLike({ AllowedMethods: ['PUT'], AllowedHeaders: ['content-type'] })] },
    LifecycleConfiguration: { Rules: Match.arrayWith([Match.objectLike({ Prefix: 'pending/', ExpirationInDays: 1, Status: 'Enabled' })]) },
  });
  template.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain', Properties: Match.objectLike({ CorsConfiguration: Match.anyValue() }) });
  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: { Variables: Match.objectLike({ FILES_BUCKET: Match.anyValue() }) },
  });
});

test('the API docs page is served at /docs/api', () => {
  // eslint-disable-next-line no-new-func
  const handler = new Function(`${REWRITE_FUNCTION_CODE}; return handler;`)();
  const uri = (u: string) => handler({ request: { uri: u } }).uri;
  expect(uri('/docs/api')).toBe('/docs-api.html');
  expect(uri('/docs/api/')).toBe('/docs-api.html');
  expect(uri('/docs/api.md')).toBe('/docs/api.md');
});

test('the managed Microsoft-token API is off unless enabled', () => {
  template.resourceCountIs('AWS::ApiGatewayV2::Api', 0);
  template.resourceCountIs('AWS::ApiGatewayV2::Authorizer', 0);
  expect(JSON.stringify(template.toJSON())).not.toContain('API_GATEWAY_ID');
  expect(template.findOutputs('MicrosoftApiUrl')).toEqual({});
});

describe('with the managed Microsoft-token API', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const routes = require('../lambda/api/routes.json') as Record<string, { scope: string; function?: string }>;
  const managed = Template.fromStack(new TravelPlanStack(new App(), 'TravelPlan', { env, microsoftApi: true }));
  const functionId = (handler: string) => Object.entries(managed.findResources('AWS::Lambda::Function'))
    .find(([, r]: any) => r.Properties.Handler === handler)![0];

  test('API Gateway checks Microsoft v2 tokens for the dliu API audience', () => {
    managed.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    managed.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      IdentitySource: ['$request.header.Authorization'],
      JwtConfiguration: {
        Issuer: { 'Fn::Join': ['', ['https://login.microsoftonline.com/', { Ref: Match.stringLikeRegexp('travelplanapitenantid') }, '/v2.0']] },
        Audience: [{ Ref: Match.stringLikeRegexp('travelplanapiaudience') }],
      },
    });
    const parameters = Object.values(managed.toJSON().Parameters).map((p: any) => p.Default);
    expect(parameters).toEqual(expect.arrayContaining(['/travel-plan/api-tenant-id', '/travel-plan/api-audience', '/travel-plan/api-client-id']));
  });

  test('exactly the published routes, each with the JWT authorizer and its one scope', () => {
    const found = Object.values(managed.findResources('AWS::ApiGatewayV2::Route')).map((r: any) => r.Properties);
    expect(found.map((r) => r.RouteKey).sort()).toEqual(Object.keys(routes).sort());
    const pdfId = functionId('pdf/index.handler');
    const apiId = functionId('index.handler');
    const integrations = managed.findResources('AWS::ApiGatewayV2::Integration');
    for (const route of found) {
      expect(route.AuthorizationType).toBe('JWT');
      expect(route.AuthorizationScopes).toEqual([routes[route.RouteKey].scope]);
      const integration: any = integrations[route.Target['Fn::Join'][1][1].Ref];
      const target = JSON.stringify(integration.Properties.IntegrationUri);
      expect(target).toContain(routes[route.RouteKey].function === 'pdf' ? pdfId : apiId);
    }
    expect(found.some((r) => r.RouteKey === '$default' || /share|auth/.test(r.RouteKey))).toBe(false);
  });

  test('both functions know the gateway, tenant, audience and client', () => {
    for (const handler of ['index.handler', 'pdf/index.handler']) {
      managed.hasResourceProperties('AWS::Lambda::Function', {
        Handler: handler,
        Environment: { Variables: Match.objectLike({
          API_GATEWAY_ID: { Ref: Match.stringLikeRegexp('MicrosoftApi') },
          API_TENANT_ID: { Ref: Match.stringLikeRegexp('travelplanapitenantid') },
          API_AUDIENCE: { Ref: Match.stringLikeRegexp('travelplanapiaudience') },
          API_CLIENT_ID: { Ref: Match.stringLikeRegexp('travelplanapiclientid') },
        }) },
      });
    }
    expect(Object.keys(managed.findOutputs('MicrosoftApiUrl'))).toHaveLength(1);
  });

  test('the website keeps its own sign-in path', () => {
    const website = template.toJSON().Resources;
    const withApi = managed.toJSON().Resources;
    for (const type of ['AWS::CloudFront::Distribution', 'AWS::Lambda::Url', 'AWS::CloudFront::Function']) {
      const pick = (resources: any) => Object.values(resources).filter((r: any) => r.Type === type).map((r: any) => r.Properties);
      expect(pick(withApi)).toEqual(pick(website));
    }
  });
});

test('the site is served from every edge location over HTTP/2 and HTTP/3', () => {
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({ PriceClass: 'PriceClass_All', HttpVersion: 'http2and3' }),
  });
});

test('static files are edge-cached for a day, HTML shells are never cached long', () => {
  const deployments = Object.values(template.findResources('Custom::CDKBucketDeployment')).map((r: any) => r.Properties);
  expect(deployments).toHaveLength(2);
  const assets = deployments.find((d: any) => !d.Include);
  const pages = deployments.find((d: any) => d.Include);
  expect(assets.SystemMetadata['cache-control']).toBe('public, max-age=300, s-maxage=86400, stale-while-revalidate=86400');
  expect(assets.Exclude).toEqual(['*.html']);
  expect(pages.SystemMetadata['cache-control']).toBe('no-cache');
  expect(pages.Exclude).toEqual(['*']);
  expect(pages.Include).toEqual(['*.html']);
  for (const deployment of deployments) {
    expect(deployment.DistributionPaths).toEqual(['/*']);
    expect(deployment.Prune).not.toBe(false);
  }
  // API, auth and PDF responses never reach the site bucket and stay uncached.
  const distribution = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0] as any;
  for (const behavior of distribution.Properties.DistributionConfig.CacheBehaviors) {
    expect(behavior.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
  }
});
