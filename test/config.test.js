'use strict';

const { loadConfig, resetConfigCache, NotConfigured } = require('../lambda/api/config');

const stored = {
  '/dliu/entra-tenant-id': ' tenant-guid ',
  '/travel-plan/entra-client-id': 'client-guid',
  '/travel-plan/entra-client-secret': 'secret-value',
};
const fakeSsm = (values) => {
  const send = jest.fn(async (command) => ({
    Parameters: command.input.Names.filter((name) => values[name]).map((Name) => ({ Name, Value: values[Name] })),
  }));
  return { send };
};

beforeEach(() => resetConfigCache());

test('reads the shared tenant and only this app\'s own client ID and secret', async () => {
  const ssm = fakeSsm(stored);
  const config = await loadConfig(ssm, 0);
  expect(ssm.send.mock.calls[0][0].input).toEqual({
    Names: ['/dliu/entra-tenant-id', '/travel-plan/entra-client-id', '/travel-plan/entra-client-secret'],
    WithDecryption: true,
  });
  expect(config).toMatchObject({ tenantId: 'tenant-guid', clientId: 'client-guid', clientSecret: 'secret-value' });
});

test('the old per-app tenant copy is not used', async () => {
  const { '/dliu/entra-tenant-id': _shared, ...rest } = stored;
  const ssm = fakeSsm({ ...rest, '/travel-plan/entra-tenant-id': 'old-copy' });
  await expect(loadConfig(ssm, 0)).rejects.toThrow(NotConfigured);
  await expect(loadConfig(ssm, 0)).rejects.toThrow('/dliu/entra-tenant-id');
});

test('caches for five minutes', async () => {
  const ssm = fakeSsm(stored);
  await loadConfig(ssm, 0);
  await loadConfig(ssm, 4 * 60 * 1000);
  expect(ssm.send).toHaveBeenCalledTimes(1);
  await loadConfig(ssm, 6 * 60 * 1000);
  expect(ssm.send).toHaveBeenCalledTimes(2);
});
