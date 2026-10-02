export type AppIconName = "home" | "garage" | "care" | "jobs" | "arrow" | "shield" | "plus" | "check";
const paths: Record<AppIconName, React.ReactNode> = {
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></>,
  garage: <><path d="M3 21V8l9-5 9 5v13M7 21v-9h10v9M7 16h10M7 19h10"/></>,
  care: <><path d="m8 4 2 6 6 2-6 2-2 6-2-6-4-2 4-2 2-6ZM18 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z"/></>,
  jobs: <><rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h3"/></>,
  arrow: <><path d="M5 12h14m-5-5 5 5-5 5"/></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  check: <><path d="m5 12 4 4L19 6"/></>,
};
export function AppIcon({ name, className }: { name: AppIconName; className?: string }) {
  return <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
