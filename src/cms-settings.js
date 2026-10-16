export function cmsSettings(tenant, publicBase) {
  const base = new URL(publicBase).origin;
  const instance = `${base}/i/${tenant.id}`;
  return {Optimizely: {
    Cms: {DamUI: {Endpoint: base, Path: `i/${tenant.id}/cloud/library-picker`}},
    Cmp: {Client: {ApiUrl: `${instance}/v3/`, TokenUrl: `${instance}/o/oauth2/v1/token`, ClientId: tenant.clientId, ClientSecret: tenant.clientSecret}}
  }};
}
