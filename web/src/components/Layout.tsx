import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight,
  BookOpenText,
  LayoutGrid,
  LogOut,
  Receipt,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
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
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/transfer', label: 'Move money', icon: ArrowLeftRight },
  { to: '/transactions', label: 'Transactions', icon: Receipt },
  { to: '/ledger', label: 'Ledger', icon: BookOpenText },
  { to: '/admin', label: 'Admin', icon: ShieldCheck, adminOnly: true },
];

function NavRow({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors',
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
            : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
        )
      }
    >
      <Icon className="size-3.5 shrink-0 opacity-80" />
      {item.label}
    </NavLink>
  );
}

export function Layout() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  const initials = (user?.name || user?.email || '?').slice(0, 1).toUpperCase();

  return (
    <div className="bg-background flex h-dvh w-full overflow-hidden">
      {/* Sidebar: Linear keeps it flush with the canvas and separates by a hairline. */}
      <aside className="border-sidebar-border bg-sidebar hidden w-[220px] shrink-0 flex-col border-r md:flex">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="hover:bg-sidebar-accent/60 m-2 flex items-center gap-2 rounded-md p-1.5 text-left transition-colors">
              <div className="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded text-[11px] font-semibold">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{user?.name || 'Ledger'}</p>
                <p className="text-muted-foreground truncate text-[11px]">{user?.email}</p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[212px]">
            <DropdownMenuLabel className="text-muted-foreground text-[11px] font-normal">
              {user?.roles?.join(', ') || 'USER'}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void logout().then(() => {
                  toast.success('Signed out');
                  navigate('/login');
                });
              }}
            >
              <LogOut className="size-3.5" />
              Log out
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void logout(true).then(() => {
                  toast.success('Signed out of every device');
                  navigate('/login');
                });
              }}
            >
              <LogOut className="size-3.5" />
              Log out everywhere
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <nav className="flex flex-1 flex-col gap-0.5 px-2 pt-1">
          {NAV.filter((item) => !item.adminOnly || isAdmin).map((item) => (
            <NavRow key={item.to} item={item} />
          ))}
        </nav>

        <div className="text-muted-foreground border-sidebar-border border-t px-3 py-2.5 text-[11px]">
          Simulation console
          <span className="mx-1.5 opacity-40">·</span>
          minor units
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile nav: the sidebar collapses into a scrollable strip. */}
        <div className="border-border flex gap-1 overflow-x-auto border-b px-2 py-1.5 md:hidden">
          {NAV.filter((item) => !item.adminOnly || isAdmin).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'shrink-0 rounded-md px-2.5 py-1.5 text-[12px] whitespace-nowrap transition-colors',
                  isActive ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground'
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto shrink-0"
            onClick={() => void logout().then(() => navigate('/login'))}
          >
            <LogOut className="size-3.5" />
          </Button>
        </div>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
