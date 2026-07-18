import { Link } from 'wouter';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="font-mono text-9xl font-black text-muted-foreground/30">404</div>
        <h1 className="text-2xl font-bold tracking-widest uppercase">Subsystem Offline</h1>
        <p className="text-muted-foreground font-mono text-sm">
          The requested operational matrix path does not exist in the current directory schema.
        </p>
        <div className="pt-4">
          <Link href="/">
            <Button className="font-bold uppercase tracking-widest">Return to Operations</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}