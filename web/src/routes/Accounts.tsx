import { useState } from 'react';
import { MoreHorizontal, Plus, Snowflake, Wallet, XCircle } from 'lucide-react';
import { api, type Account, type AccountType, type BalanceReport } from '@/lib/api';
import { describeError, useAsync } from '@/lib/useAsync';
import { CURRENCIES } from '@/lib/money';
import { EmptyState, InlineError, Money, PageHeader, StatusBadge, SubmitButton } from '@/components/primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

const TYPES: AccountType[] = ['SAVINGS', 'CURRENT', 'WALLET'];

export function Accounts() {
  const { data, error, loading, reload } = useAsync(async () => {
    const accounts = await api.accounts.list();
    const balances = await Promise.all(
      accounts.filter((a) => a.status !== 'CLOSED').map((a) => api.accounts.balance(a._id))
    );
    return { accounts, balances };
  }, []);

  const [closing, setClosing] = useState<Account | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, label: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try {
      await fn();
      toast.success(label);
      await reload();
    } catch (err) {
      toast.error(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  function reportFor(id: string): BalanceReport | undefined {
    return data?.balances.find((b) => b.accountId === id);
  }

  return (
    <div>
      <PageHeader
        title="Accounts"
        description="Accounts always open at zero — money only enters through a ledgered deposit."
        actions={<OpenAccountDialog onDone={reload} />}
      />

      {error && (
        <Alert variant="destructive" className="mb-5">
          <AlertDescription className="text-[12px]">{error}</AlertDescription>
        </Alert>
      )}

      <Card className="surface-edge gap-0 overflow-hidden py-0">
        <CardContent className="p-0">
          {/* Keep the table on screen while a refresh runs, so acting on a row
              does not make the whole list flash. */}
          {loading && !data ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : data!.accounts.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No accounts"
              description="Open a savings, current or wallet account to begin."
              action={<OpenAccountDialog onDone={reload} />}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[11px]">Account</TableHead>
                  <TableHead className="text-[11px]">Type</TableHead>
                  <TableHead className="text-[11px]">Status</TableHead>
                  <TableHead className="text-right text-[11px]">Available</TableHead>
                  <TableHead className="text-right text-[11px]">Balance</TableHead>
                  <TableHead className="text-[11px]">Ledger</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data!.accounts.map((account) => {
                  const report = reportFor(account._id);
                  return (
                    <TableRow key={account._id}>
                      <TableCell>
                        <div className="font-medium">
                          {(account.metadata?.nickname as string) || 'Account'}
                        </div>
                        <div className="text-muted-foreground font-mono text-[11px]">
                          {account.accountNumber}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{account.accountType}</TableCell>
                      <TableCell>
                        <StatusBadge status={account.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money
                          minor={report?.availableBalance ?? account.availableBalance}
                          currency={account.currency}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money minor={report?.balance ?? account.balance} currency={account.currency} />
                      </TableCell>
                      <TableCell>
                        {report ? (
                          <span
                            className={
                              report.reconciled
                                ? 'text-[11px] text-[var(--credit)]'
                                : 'text-destructive text-[11px] font-medium'
                            }
                          >
                            {report.reconciled ? 'reconciled' : 'drifted'}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-[11px]">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              disabled={busy === account._id || account.status === 'CLOSED'}
                            >
                              <MoreHorizontal className="size-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <RenameItem account={account} onDone={reload} />
                            <DropdownMenuSeparator />
                            {account.status === 'ACTIVE' ? (
                              <DropdownMenuItem
                                onSelect={() =>
                                  void act(account._id, 'Account frozen', () =>
                                    api.accounts.freeze(account._id)
                                  )
                                }
                              >
                                <Snowflake className="size-3.5" />
                                Freeze
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onSelect={() =>
                                  void act(account._id, 'Account unfrozen', () =>
                                    api.accounts.unfreeze(account._id)
                                  )
                                }
                              >
                                <Snowflake className="size-3.5" />
                                Unfreeze (admin only)
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem variant="destructive" onSelect={() => setClosing(account)}>
                              <XCircle className="size-3.5" />
                              Close account
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={Boolean(closing)} onOpenChange={(open) => !open && setClosing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this account?</AlertDialogTitle>
            <AlertDialogDescription className="text-[12px]">
              Closing is permanent and the account can no longer send or receive. The API refuses to close an
              account that still holds a balance — move the funds out first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = closing!;
                setClosing(null);
                void act(target._id, 'Account closed', () => api.accounts.close(target._id));
              }}
            >
              Close account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function OpenAccountDialog({ onDone }: { onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [accountType, setAccountType] = useState<AccountType>('SAVINGS');
  const [currency, setCurrency] = useState('INR');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const account = await api.accounts.create({ accountType, currency });
      if (nickname.trim()) await api.accounts.setMetadata(account._id, { nickname: nickname.trim() });
      toast.success(`Account ${account.accountNumber} opened`);
      setOpen(false);
      setNickname('');
      await onDone();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-3.5" />
          Open account
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Open an account</DialogTitle>
          <DialogDescription className="text-[12px]">
            The account number is generated by the server and the opening balance is always zero.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={accountType} onValueChange={(v) => setAccountType(v as AccountType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nickname">Nickname</Label>
            <Input
              id="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Rainy day"
            />
            <p className="text-muted-foreground text-[11px]">
              Stored in the account's metadata, the only client-writable field.
            </p>
          </div>

          <InlineError message={error} />
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton pending={pending} onClick={() => void submit()}>
            Open account
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameItem({ account, onDone }: { account: Account; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState((account.metadata?.nickname as string) || '');
  const [pending, setPending] = useState(false);

  return (
    <>
      <DropdownMenuItem onSelect={(e) => (e.preventDefault(), setOpen(true))}>Rename</DropdownMenuItem>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>Rename account</DialogTitle>
          </DialogHeader>
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Rainy day" />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton
              pending={pending}
              onClick={async () => {
                setPending(true);
                try {
                  await api.accounts.setMetadata(account._id, { ...account.metadata, nickname: value });
                  toast.success('Renamed');
                  setOpen(false);
                  await onDone();
                } catch (err) {
                  toast.error(describeError(err));
                } finally {
                  setPending(false);
                }
              }}
            >
              Save
            </SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
