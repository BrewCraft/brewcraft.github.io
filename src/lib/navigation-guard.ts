type NavigationGuard = () => boolean;

let activeGuard: NavigationGuard | null = null;

export function setNavigationGuard(guard: NavigationGuard | null): void {
  activeGuard = guard;
}

export function confirmNavigationIfGuarded(): boolean {
  return activeGuard ? activeGuard() : true;
}
