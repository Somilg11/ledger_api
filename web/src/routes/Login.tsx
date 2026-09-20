import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { describeError } from '@/lib/useAsync';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function Login() {
  const { user, ready, login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (ready && user) return <Navigate to="/" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await register({ email, password, name: name || undefined });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="bg-background flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-[360px]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
            <Landmark className="size-4" />
          </div>
          <div className="space-y-1">
            <h1 className="text-[15px] font-semibold tracking-tight">Ledger Console</h1>
            <p className="text-muted-foreground text-[12px]">
              Simulation front end for the double-entry banking API
            </p>
          </div>
        </div>

        <Tabs value={mode} onValueChange={setMode}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Sign in</TabsTrigger>
            <TabsTrigger value="register">Create account</TabsTrigger>
          </TabsList>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <TabsContent value="register" className="m-0 space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alice" />
            </TabsContent>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alice@example.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
              />
              {mode === 'register' && (
                <p className="text-muted-foreground text-[11px]">
                  At least 10 characters with upper and lower case, a digit and a symbol.
                </p>
              )}
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription className="text-[12px]">{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
        </Tabs>

        <p className="text-muted-foreground mt-6 text-center text-[11px]">
          Five failed sign-ins lock the account for 15 minutes.
        </p>
      </div>
    </div>
  );
}
