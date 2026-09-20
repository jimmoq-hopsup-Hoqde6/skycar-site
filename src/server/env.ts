export type SkycarEnvironment="demo"|"staging"|"production";
export function getPublicEnvironment():SkycarEnvironment{const value=process.env.SKYCAR_ENV??"demo";if(value==="demo"||value==="staging"||value==="production")return value;throw new Error("SKYCAR_ENV must be demo, staging or production")}
export function requireSupabasePublicConfig(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const publishableKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;if(!url||!publishableKey)throw new Error("Supabase public configuration is missing");return{url,publishableKey}}
export function featureEnabled(name:"GARAGE"|"CARE"|"BENEFITS"|"SELL"){return process.env[`FEATURE_${name}`]==="true"}
