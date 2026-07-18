import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Roles() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight border-b pb-4">Authorization Roles</h1>
      <Card className="border shadow-sm">
        <CardHeader className="bg-muted/20 border-b">
          <CardTitle className="text-sm font-bold uppercase tracking-widest">Role Policies</CardTitle>
        </CardHeader>
        <CardContent className="p-12 text-center text-muted-foreground font-mono text-sm uppercase tracking-wide">
          Loading policy definitions...
        </CardContent>
      </Card>
    </div>
  );
}