import { useEffect, useRef, useState } from 'react';
import { RouteBoundary } from '@/components/RouteBoundary';
import { LedgerLogo } from '@/components/LedgerLogo';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeftRight,
  BookOpenText,
  LayoutGrid,
  LogOut,
  Receipt,
  FlaskConical,
  ShieldCheck,
  Wallet,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}
const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutGrid },
  { to: '/playground', label: 'Playground', icon: FlaskConical },
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/transfer', label: 'Move money', icon: ArrowLeftRight },
  { to: '/transactions', label: 'Transactions', icon: Receipt },
  { to: '/ledger', label: 'Ledger', icon: BookOpenText },
  { to: '/demo', label: 'Demo guide', icon: BookOpenText },
  { to: '/admin', label: 'Admin', icon: ShieldCheck, adminOnly: true },
];

function NavRow({
  item,
  collapsed = false,
  onNavigate,
}: {
  item: NavItem;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const { pathname } = useLocation();
  const isActive = pathname === item.to || (item.to !== '/' && pathname.startsWith(`${item.to}/`));
  const link = (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      aria-label={item.label}
      onClick={onNavigate}
      className={cn(
        'flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-3 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        collapsed && 'size-9 justify-center gap-0 p-0',
        isActive
          ? 'bg-primary/12 text-primary font-medium ring-1 ring-primary/15'
          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className={collapsed ? 'sr-only' : ''}>{item.label}</span>
    </NavLink>
  );
  return collapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  ) : (
    link
  );
}

export function Layout() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const content = useRef<HTMLElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('ledger.sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    content.current?.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem('ledger.sidebar-collapsed', String(collapsed));
    } catch {
      /* The navigation still works without storage. */
    }
  }, [collapsed]);
  const items = NAV.filter((item) => !item.adminOnly || isAdmin);
  const title = NAV.find((item) => item.to === location.pathname)?.label ?? 'Workspace';

  function signOut(all = false) {
    void logout(all).then(() => {
      toast.success(all ? 'Signed out of every device' : 'Signed out');
      navigate('/login');
    });
  }

  return (
    <div className="bg-background flex h-dvh w-full overflow-hidden">
      <a
        href="#main-content"
        className="bg-primary text-primary-foreground fixed top-2 left-2 z-[100] -translate-y-20 rounded-md px-4 py-2 text-sm focus:translate-y-0"
      >
        Skip to content
      </a>
      <aside
        aria-label="Desktop sidebar"
        data-collapsed={collapsed}
        className={cn(
          'border-sidebar-border bg-sidebar hidden shrink-0 flex-col border-r transition-[width] duration-200 motion-reduce:transition-none md:flex',
          collapsed ? 'w-[64px]' : 'w-[224px]'
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Account menu"
              className={cn(
                'hover:bg-sidebar-accent m-3 flex min-h-10 items-center gap-2.5 rounded-lg p-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
                collapsed && 'mx-2 justify-center'
              )}
            >
              <div className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg shadow-sm">
                <LedgerLogo className="size-8" />
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Ledger</p>
                  <p className="text-muted-foreground truncate text-[10px]">{user?.email}</p>
                </div>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={collapsed ? 'right' : 'bottom'} align="start" className="w-[212px]">
            <DropdownMenuLabel className="break-all text-xs">{user?.email}</DropdownMenuLabel>
            <DropdownMenuLabel className="text-muted-foreground text-[11px] font-normal">
              {user?.roles?.join(', ') || 'USER'}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => signOut()}>
              <LogOut className="size-3.5" />
              Log out
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => signOut(true)}>
              <LogOut className="size-3.5" />
              Log out everywhere
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {!collapsed && (
          <p className="text-muted-foreground/60 px-6 pt-4 pb-2 text-[10px] font-medium tracking-[.14em] uppercase">
            Workspace
          </p>
        )}
        <nav
          id="desktop-navigation"
          aria-label="Main navigation"
          className={cn('flex flex-1 flex-col gap-1 px-3', collapsed && 'items-center px-2 pt-3')}
        >
          {items.map((item) => (
            <NavRow key={item.to} item={item} collapsed={collapsed} />
          ))}
        </nav>
        <div className="border-sidebar-border space-y-2 border-t p-3">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'text-muted-foreground w-full justify-start gap-2.5',
              collapsed && 'justify-center px-0'
            )}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            aria-controls="desktop-navigation"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            {!collapsed && <span>Collapse sidebar</span>}
          </Button>
          {!collapsed && (
            <div className="text-muted-foreground/60 flex items-center gap-2 px-3 pb-1 text-[10px]">
              <span className="bg-primary size-1.5 rounded-full" />
              Simulation workspace
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border/70 bg-background/95 flex h-12 shrink-0 items-center gap-3 border-b px-4 md:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open navigation">
                <Menu className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[min(84vw,300px)] gap-2">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <LedgerLogo className="text-primary size-8" />
                  Ledger
                </SheetTitle>
                <SheetDescription className="truncate">{user?.email}</SheetDescription>
              </SheetHeader>
              <nav aria-label="Mobile navigation" className="flex flex-col gap-1 px-3">
                {items.map((item) => (
                  <NavRow key={item.to} item={item} onNavigate={() => setMobileOpen(false)} />
                ))}
              </nav>
            </SheetContent>
          </Sheet>
          <span className="text-muted-foreground hidden text-xs sm:inline">Workspace</span>
          <ChevronRight className="text-muted-foreground/40 hidden size-3 sm:block" />
          <span className="truncate text-xs font-medium">{title}</span>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-muted-foreground hidden items-center gap-1.5 text-[10px] sm:flex">
              <span className="bg-primary size-1.5 rounded-full" />
              Simulated money
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              aria-label="Log out"
              onClick={() => signOut()}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>
        <main
          id="main-content"
          ref={content}
          tabIndex={-1}
          className={cn(
            'relative min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none',
            location.pathname === '/playground' && 'playground-shell xl:overflow-hidden'
          )}
        >
          <div
            className={cn(
              'mx-auto w-full px-4 py-6 md:px-6 md:py-7',
              location.pathname === '/playground' ? 'max-w-[1800px] xl:h-full xl:py-4' : 'max-w-6xl'
            )}
          >
            <RouteBoundary>
              <Outlet />
            </RouteBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
