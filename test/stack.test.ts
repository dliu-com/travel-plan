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
  expect(behaviors.map((b: any) => b.PathPattern).sort()).toEqual(['api/*', 'auth/*']);
  for (const behavior of behaviors) {
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
  expect(uri('/app.js')).toBe('/app.js');
});

test('logs go to the traffic monitor under the plan site key', () => {
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      Logging: Match.objectLike({ Prefix: 'raw/plan/', IncludeCookies: true }),
    }),
  });
});

test('traffic logging can be turned off', () => {
  const quiet = Template.fromStack(new TravelPlanStack(new App(), 'Quiet', { env, trafficLogging: false }));
  const distribution = Object.values(quiet.findResources('AWS::CloudFront::Distribution'))[0] as any;
  expect(distribution.Properties.DistributionConfig.Logging).toBeUndefined();
});

test('pages are not indexed and only load our own scripts', () => {
  template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
    ResponseHeadersPolicyConfig: Match.objectLike({
      CustomHeadersConfig: { Items: [Match.objectLike({ Header: 'X-Robots-Tag' })] },
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
