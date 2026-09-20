export const APP_ROLES=["customer","technician","fleet_member","fleet_admin","admin"] as const;
export type AppRole=(typeof APP_ROLES)[number];
export function isAppRole(value:string):value is AppRole{return APP_ROLES.includes(value as AppRole)}
