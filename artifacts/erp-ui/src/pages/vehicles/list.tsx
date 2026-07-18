import { useState } from 'react';
import { useListVehicles, getListVehiclesQueryKey, useCreateVehicle } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Truck } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

export default function VehiclesList() {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useListVehicles({ search }, { query: { queryKey: getListVehiclesQueryKey({ search }) } });
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <h1 className="text-3xl font-bold tracking-tight">Fleet Registry</h1>
        <CreateVehicleDialog />
      </div>

      <div className="flex gap-4 items-center max-w-sm">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search plates..." 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            className="pl-9 bg-card border-border shadow-sm font-mono text-sm" 
          />
        </div>
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-24">Plate Reg.</TableHead>
              <TableHead>Customer Link</TableHead>
              <TableHead>Class Type</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={3} className="text-center py-12 font-mono text-sm text-muted-foreground animate-pulse">Scanning registry...</TableCell></TableRow>
            ) : data?.length ? (
              data.map(v => (
                <TableRow key={v.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell>
                    <div className="px-3 py-1 bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border-2 border-zinc-400 dark:border-zinc-600 rounded inline-block font-mono font-black text-sm tracking-wider uppercase">
                      {v.number_plate}
                    </div>
                  </TableCell>
                  <TableCell className="font-bold">{v.customer_name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm uppercase tracking-wide flex items-center gap-2">
                    <Truck className="h-4 w-4" /> {v.vehicle_type_name || 'UNCLASSIFIED'}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow><TableCell colSpan={3} className="text-center py-16 font-mono text-sm text-muted-foreground">No fleet records found.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CreateVehicleDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateVehicle();
  const [formData, setFormData] = useState({ number_plate: '', customer: 1 });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({ data: formData }, {
      onSuccess: () => {
        toast({ title: 'Asset Registered' });
        queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
        setOpen(false);
        setFormData({ number_plate: '', customer: 1 });
      },
      onError: () => toast({ title: 'Registration Failed', variant: 'destructive' })
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 font-bold uppercase tracking-wide"><Plus className="h-4 w-4" /> Register Asset</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="font-bold uppercase tracking-widest">New Fleet Asset</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 pt-4">
          <div className="grid gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Registration Plate</label>
              <Input 
                value={formData.number_plate} 
                onChange={e => setFormData({...formData, number_plate: e.target.value.toUpperCase()})} 
                required 
                className="font-mono text-lg font-black tracking-widest uppercase border-2 focus-visible:ring-primary" 
                placeholder="ABC-1234" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Owner Entity ID</label>
              <Input 
                type="number" 
                value={formData.customer} 
                onChange={e => setFormData({...formData, customer: Number(e.target.value)})} 
                required 
                className="font-mono text-sm" 
              />
            </div>
          </div>
          <Button type="submit" className="w-full font-bold uppercase tracking-widest" disabled={create.isPending}>
            {create.isPending ? 'Committing...' : 'Commit Registration'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}