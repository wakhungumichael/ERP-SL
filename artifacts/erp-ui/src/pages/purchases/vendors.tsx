import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';

type Vendor = {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  contact_person?: string;
};

export default function VendorsPage() {
  const { token } = useAuth();
  const [search, setSearch] = useState('');

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  const qs = params.toString() ? '?' + params.toString() : '';

  const { data, isLoading } = useQuery({
    queryKey: ['vendors', token, search],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(BASE_URL + '/api/purchases/vendors/' + qs, {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!r.ok) throw new Error('fetch failed');
      return r.json();
    },
  });

  const vendors: Vendor[] = Array.isArray(data) ? data : (data?.vendors ?? data?.results ?? []);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Vendors</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Vendor records are managed under <span className="font-medium">CRM → Suppliers</span>.
          </p>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Vendors</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-2xl font-semibold">{vendors.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="max-w-xs">
        <Input
          placeholder="Search vendors…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-sm"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Loading…</div>
          ) : vendors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a4 4 0 00-5.916-3.517M9 20H4v-2a4 4 0 015.916-3.517M15 11a4 4 0 11-8 0 4 4 0 018 0zm6 0a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-sm">No vendors found</span>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Contact Person</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((v) => (
                  <TableRow key={v.id} className="hover:bg-muted/50">
                    <TableCell className="font-medium">{v.name}</TableCell>
                    <TableCell>{v.email ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{v.phone ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{v.contact_person ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
