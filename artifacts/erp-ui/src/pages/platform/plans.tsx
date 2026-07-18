import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Plans() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight border-b pb-4">Subscription Plans</h1>
      <Card className="border shadow-sm">
        <CardHeader className="bg-muted/20 border-b">
          <CardTitle className="text-sm font-bold uppercase tracking-widest">Tier Definitions</CardTitle>
        </CardHeader>
        <CardContent className="p-12 text-center text-muted-foreground font-mono text-sm uppercase tracking-wide">
          Fetching commercial tiers...
        </CardContent>
      </Card>
    </div>
  );
}