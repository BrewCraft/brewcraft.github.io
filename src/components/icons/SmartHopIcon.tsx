export function SmartHopIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18.5 2l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5z" />
      <path d="M13.5 3.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5z" />
      <path d="M11 22c-4.5 0-8-4-8-9 0-3.5 2.5-6.5 6-7.5h4c3 1 5 3.5 5 6.5 0 1-.2 2-.5 3" />
      <path d="M11 22v-9" />
      <path d="M6 12c1-2 3-3 5-3" />
      <path d="M15 11c-1-1.5-2.5-2.5-4-2.5" />
    </svg>
  );
}
