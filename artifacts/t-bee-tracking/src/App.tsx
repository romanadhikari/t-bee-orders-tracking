import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import {
  useTrackOrder, useGetAdminSession, useAdminLogin, useAdminLogout,
  useGetAdminDashboard, useListAdminOrders, useCreateAdminOrder, useGetNewTrackingId,
  useGetAdminOrder, useUpdateAdminOrder, useDeleteAdminOrder, useUpdateAdminOrderStatus,
  useRequestOrderImageUpload, trackOrder, getGetAdminSessionQueryKey, getGetAdminDashboardQueryKey,
  getListAdminOrdersQueryKey, getGetAdminOrderQueryKey, getGetNewTrackingIdQueryKey,
} from '@workspace/api-client-react';
import type { AdminOrder, AdminOrderSummary, OrderStatus, ProductInput, TrackingOrder } from '@workspace/api-client-react';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Check, Copy, Download,
  ExternalLink, ImagePlus, LoaderCircle, LockKeyhole, LogOut, Package,
  Search, ShieldCheck, ShoppingBag, X,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const statuses: OrderStatus[] = ['pending','verified','processing','ready_for_dispatch','out_for_delivery','delivered','cancelled'];
const labels: Record<OrderStatus,string> = {
  pending:'Order received', verified:'Order verified', processing:'Being prepared',
  ready_for_dispatch:'Ready for dispatch', out_for_delivery:'Out for delivery',
  delivered:'Delivered', cancelled:'Cancelled',
};
const money = (amount: number) => `Rs. ${Number(amount || 0).toLocaleString('en-IN')}`;
const date = (value?: string | null) => value ? new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)) : '—';
const errorText = (error: unknown) => {
  if (error && typeof error === 'object' && 'message' in error) return String((error as {message: unknown}).message);
  return 'Something went wrong. Please try again.';
};

function BrandMark({ small = false }: { small?: boolean }) {
  return <img src="/brand/t-bee-mark.png" alt="T-Bee" className={small ? 'h-10 w-10 object-contain' : 'h-12 w-12 object-contain'} />;
}

function Header() {
  const [path] = useLocation();
  return <header className="sticky top-0 z-40 border-b border-black/10 bg-[#F5F3ED]/95 backdrop-blur">
    <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 md:px-10">
      <Link href="/" className="flex items-center gap-2.5" data-testid="link-brand"><BrandMark small/><span className="font-display text-[19px] font-bold tracking-[-.07em]">T-BEE<span className="text-[#B78900]">.</span></span></Link>
      <nav className="flex items-center gap-5 text-[10px] font-bold tracking-[.14em] md:gap-10 md:text-[11px]">
        <a className="transition-colors hover:text-[#9B7400]" href="https://t-bee-clothing.netlify.app/" target="_blank" rel="noreferrer" data-testid="link-home">HOME <ExternalLink className="ml-1 inline h-3 w-3"/></a>
        <Link className={path === '/' ? 'text-[#8D6900]' : 'hover:text-[#8D6900]'} href="/" data-testid="link-track">TRACK ORDER</Link>
        <Link className={path === '/login' ? 'text-[#8D6900]' : 'hover:text-[#8D6900]'} href="/login" data-testid="link-login">LOGIN</Link>
      </nav>
    </div>
  </header>;
}

function PageShell({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <div className={`noise min-h-[100dvh] ${dark ? 'bg-[#111] text-[#F5F3ED]' : 'bg-[#F5F3ED] text-[#111]'}`}><Header/>{children}</div>;
}

function Button({ children, onClick, type = 'button', variant = 'yellow', disabled = false, className = '', testId }: {
  children: React.ReactNode; onClick?: () => void; type?: 'button'|'submit'; variant?: 'yellow'|'black'|'line'|'quiet'|'danger'; disabled?: boolean; className?: string; testId?: string;
}) {
  const theme = {yellow:'bg-[#FFC400] text-[#111] hover:bg-[#e6b000]',black:'bg-[#111] text-[#F5F3ED] hover:bg-[#303030]',line:'border border-black/20 bg-transparent hover:bg-black/[.04]',quiet:'bg-transparent hover:bg-black/[.06]',danger:'bg-[#a62720] text-white hover:bg-[#871e19]'}[variant];
  return <button type={type} onClick={onClick} disabled={disabled} data-testid={testId} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-5 text-[11px] font-bold tracking-[.1em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${theme} ${className}`}>{children}</button>;
}

function Field({ label, value, onChange, placeholder, type = 'text', required = false, multiline = false, hint, testId, autoComplete }: {
  label: string; value: string | number; onChange: (value: string) => void; placeholder?: string; type?: string; required?: boolean; multiline?: boolean; hint?: string; testId?: string; autoComplete?: string;
}) {
  const cls = 'w-full rounded-sm border border-black/15 bg-[#FBFAF6] px-3.5 py-3 text-[14px] text-[#111] outline-none transition focus:border-[#111] focus:ring-2 focus:ring-[#FFC400]/60 placeholder:text-[#9B9992]';
  return <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-[#777]">{label}{required && <span className="ml-1 text-[#A37B00]">*</span>}</span>{multiline ? <textarea rows={3} className={`${cls} resize-y`} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} required={required} data-testid={testId}/> : <input className={cls} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} type={type} required={required} autoComplete={autoComplete} data-testid={testId}/ >}{hint && <small className="block text-[11px] text-[#777]">{hint}</small>}</label>;
}

function LoadingBlock({ message = 'Loading order details' }: { message?: string }) {
  return <div className="animate-pulse space-y-4 rounded-sm border border-black/10 bg-white/40 p-6" role="status"><span className="sr-only">{message}</span><div className="h-3 w-28 rounded bg-black/10"/><div className="h-8 w-2/3 rounded bg-black/10"/><div className="h-20 rounded bg-black/[.06]"/></div>;
}

function StatusPill({ status }: { status: OrderStatus }) {
  const complete = status === 'delivered', cancelled = status === 'cancelled';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.07em] ${complete ? 'bg-[#e4eddf] text-[#385a31]' : cancelled ? 'bg-[#f4e1de] text-[#8b3329]' : 'bg-[#fff0b8] text-[#654d00]'}`} data-testid={`status-${status}`}>{labels[status]}</span>;
}

function Timeline({ order }: { order: TrackingOrder }) {
  const orderedHistory = [...order.statusHistory].sort((a,b)=>new Date(a.updatedAt).getTime()-new Date(b.updatedAt).getTime());
  const events = [{ label: 'Order Placed', updatedAt: order.createdAt }, ...orderedHistory.map(event=>({label:labels[event.status],updatedAt:event.updatedAt}))];
  return <ol className="relative ml-1 mt-5 space-y-0 border-l border-black/15 pl-6" data-testid="order-status-history">
    {events.map((event,index)=><li key={`${event.label}-${event.updatedAt}-${index}`} className="relative pb-6 last:pb-0">
      <span className={`absolute -left-[31px] top-1 flex h-3 w-3 items-center justify-center rounded-full ring-4 ring-[#F5F3ED] ${index === events.length-1 ? 'bg-[#FFC400]' : 'bg-[#111]'}`}/>
      <div className="flex flex-wrap items-start justify-between gap-2"><p className="text-[13px] font-semibold">{event.label}</p><time className="text-[10px] text-[#777]">{date(event.updatedAt)}</time></div>
    </li>)}
  </ol>;
}

function Invoice({ order, onDownload }: { order: TrackingOrder; onDownload: () => void }) {
  return <section id="invoice" className="overflow-hidden border border-black/15 bg-[#FBFAF6]" data-testid="invoice-preview">
      <div className="flex items-start justify-between border-b-[5px] border-[#FFC400] bg-[#111] px-5 py-5 text-[#F5F3ED] md:px-7">
      <div className="flex items-center gap-3"><BrandMark small/><div><p className="font-display text-xl font-bold tracking-[-.06em]">T-BEE</p><p className="text-[9px] tracking-[.16em] text-white/60">BIRTAMODE · JHAPA · NEPAL</p></div></div>
      <div className="text-right"><p className="text-[9px] font-bold tracking-[.18em] text-[#FFC400]">INVOICE</p><p className="mt-1 font-display text-sm font-semibold">{order.trackingId}</p></div>
    </div>
    <div className="p-5 md:p-7">
      <div className="mb-6 grid grid-cols-2 gap-4 border-b border-black/10 pb-5 text-[12px]">
        <div><p className="text-[9px] font-bold tracking-[.13em] text-[#777]">BILLED TO</p><p className="mt-1 font-semibold">{order.customerName}</p><p className="whitespace-pre-line text-[#777]">{order.deliveryAddress}</p>{order.landmark && <p className="text-[#777]">Near {order.landmark}</p>}</div>
        <div className="text-right"><p className="text-[9px] font-bold tracking-[.13em] text-[#777]">ORDER DATE</p><p className="mt-1 font-semibold">{date(order.createdAt)}</p><p className="mt-3"><StatusPill status={order.status}/></p></div>
      </div>
      <div className="space-y-0">
        <div className="grid grid-cols-[1fr_38px_64px_76px] border-b border-black/15 pb-2 text-[9px] font-bold tracking-[.1em] text-[#777]"><span>ITEM</span><span className="text-center">QTY</span><span className="text-right">PRICE</span><span className="text-right">AMOUNT</span></div>
        {order.items.map(item=><div key={item.id} className="grid grid-cols-[1fr_38px_64px_76px] items-start border-b border-black/[.07] py-3 text-[11px]"><span className="min-w-0 break-words pr-2">{item.productName}</span><span className="text-center">{item.quantity}</span><span className="text-right">{money(item.unitPrice)}</span><span className="text-right font-semibold">{money(item.lineSubtotal)}</span></div>)}
      </div>
      <div className="ml-auto mt-4 max-w-[240px] space-y-2 text-[12px]"><div className="flex justify-between"><span className="text-[#777]">Items subtotal</span><span>{money(order.productSubtotal)}</span></div><div className="flex justify-between"><span className="text-[#777]">Delivery</span><span>{order.deliveryCharge ? money(order.deliveryCharge) : 'Included'}</span></div>{order.discountAmount > 0 && <div className="flex justify-between"><span className="text-[#777]">Discount</span><span>− {money(order.discountAmount)}</span></div>}<div className="flex justify-between border-t border-black pt-3 text-[15px] font-bold"><span>TOTAL</span><span>{money(order.finalTotal)}</span></div></div>
       <p className="mt-7 border-t border-dashed border-black/20 pt-4 text-center text-[10px] text-[#777]">Thank you for choosing T-Bee Clothing. Wear your vision. Stay original.</p>
      <Button className="mt-5 w-full" onClick={onDownload} testId="button-download-invoice"><Download className="h-4 w-4"/> DOWNLOAD INVOICE PNG</Button>
    </div>
  </section>;
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines = 6) {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.…]+$/, '')}…`;
  }
  return lines;
}

async function downloadInvoice(order: TrackingOrder) {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 1;
  const measure = canvas.getContext('2d');
  if (!measure) return;

  const logo = await new Promise<HTMLImageElement | null>(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = '/brand/t-bee-mark.png';
  });

  measure.font = 'bold 16px sans-serif';
  const customerLines = wrapCanvasText(measure, order.customerName, 590, 3);
  measure.font = '14px sans-serif';
  const addressLines = wrapCanvasText(measure, order.deliveryAddress, 590, 20);
  const landmarkLines = order.landmark ? wrapCanvasText(measure, `Landmark: ${order.landmark}`, 590, 8) : [];
  const itemRows = order.items.map(item => {
    measure.font = '15px sans-serif';
    const nameLines = wrapCanvasText(measure, item.productName, 500, 3);
    return { item, nameLines, height: Math.max(56, nameLines.length * 20 + 22) };
  });
  const tableTop = Math.max(315, 260 + (customerLines.length + addressLines.length + landmarkLines.length) * 20);
  const rowsHeight = itemRows.reduce((total, row) => total + row.height, 0);
  const summaryLines = order.discountAmount > 0 ? 4 : 3;
  canvas.height = tableTop + 52 + rowsHeight + summaryLines * 34 + 175;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#F5F3ED';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, canvas.width, 150);
  ctx.fillStyle = '#FFC400';
  ctx.fillRect(0, 144, canvas.width, 6);
  if (logo) ctx.drawImage(logo, 55, 25, 100, 100);
  ctx.fillStyle = '#FFC400';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('T-BEE CLOTHING', 180, 56);
  ctx.fillStyle = '#F5F3ED';
  ctx.font = '13px sans-serif';
  ctx.fillText('Birtamode, Jhapa, Nepal', 180, 81);
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('INVOICE', 180, 121);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#FFC400';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('TRACKING / INVOICE ID', 945, 58);
  ctx.fillStyle = '#F5F3ED';
  ctx.font = 'bold 19px sans-serif';
  ctx.fillText(order.trackingId, 945, 91);
  ctx.textAlign = 'left';

  let y = 194;
  ctx.fillStyle = '#777777';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText('BILLED TO', 60, y);
  ctx.fillText('ORDER DATE', 680, y);
  y += 27;
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 16px sans-serif';
  customerLines.forEach(line => { ctx.fillText(line, 60, y); y += 20; });
  ctx.textAlign = 'right';
  ctx.font = '14px sans-serif';
  ctx.fillText(date(order.createdAt), 945, 221);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#777777';
  ctx.font = '14px sans-serif';
  addressLines.forEach(line => { ctx.fillText(line, 60, y); y += 20; });
  landmarkLines.forEach(line => { ctx.fillText(line, 60, y); y += 20; });

  y = tableTop;
  ctx.fillStyle = '#777777';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText('PRODUCT', 60, y);
  ctx.textAlign = 'center';
  ctx.fillText('QTY', 700, y);
  ctx.textAlign = 'right';
  ctx.fillText('UNIT PRICE', 845, y);
  ctx.fillText('AMOUNT', 945, y);
  ctx.textAlign = 'left';
  ctx.strokeStyle = '#111111';
  ctx.beginPath();
  ctx.moveTo(60, y + 13);
  ctx.lineTo(945, y + 13);
  ctx.stroke();

  y += 42;
  for (const row of itemRows) {
    ctx.fillStyle = '#111111';
    ctx.font = '15px sans-serif';
    row.nameLines.forEach((line, index) => ctx.fillText(line, 60, y + index * 20, 500));
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(row.item.quantity), 700, y);
    ctx.textAlign = 'right';
    ctx.fillText(money(row.item.unitPrice), 845, y);
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(money(row.item.lineSubtotal), 945, y);
    ctx.textAlign = 'left';
    y += row.height;
    ctx.strokeStyle = '#d8d5cd';
    ctx.beginPath();
    ctx.moveTo(60, y - 10);
    ctx.lineTo(945, y - 10);
    ctx.stroke();
  }

  y += 28;
  const summary = [
    ['Items subtotal', money(order.productSubtotal)],
    [`Delivery · ${order.deliveryOption === 'birtamode' ? 'Birtamode' : 'Outside Birtamode'}`, money(order.deliveryCharge)],
    ...(order.discountAmount > 0 ? [['Discount', `− ${money(order.discountAmount)}`]] : []),
  ];
  ctx.font = '14px sans-serif';
  for (const [label, amount] of summary) {
    ctx.fillStyle = '#777777';
    ctx.fillText(label, 650, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#111111';
    ctx.fillText(amount, 945, y);
    ctx.textAlign = 'left';
    y += 32;
  }
  ctx.strokeStyle = '#111111';
  ctx.beginPath();
  ctx.moveTo(650, y - 10);
  ctx.lineTo(945, y - 10);
  ctx.stroke();
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('TOTAL', 650, y + 20);
  ctx.textAlign = 'right';
  ctx.fillText(money(order.finalTotal), 945, y + 20);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#777777';
  ctx.font = '13px sans-serif';
  ctx.fillText('Thank you for choosing T-Bee Clothing. Wear your vision. Stay original.', 500, canvas.height - 45);

  const link = document.createElement('a');
  link.download = `T-Bee-${order.trackingId}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function TrackPage() {
  const track = useTrackOrder(); const queryClient=useQueryClient(); const [trackingId,setTrackingId]=useState(''); const [submitted,setSubmitted]=useState(false); const [activeTrackingId,setActiveTrackingId]=useState('');
  const liveTracking=useQuery({queryKey:['public-order-tracking',activeTrackingId],queryFn:()=>trackOrder({trackingId:activeTrackingId}),enabled:Boolean(activeTrackingId),staleTime:12000,refetchInterval:15000,refetchOnWindowFocus:true,retry:1});
  const order=(liveTracking.data ?? track.data) as TrackingOrder|undefined;
  function submit(e: React.FormEvent) { e.preventDefault(); const id=trackingId.trim().toUpperCase(); setActiveTrackingId(''); setSubmitted(true); track.mutate({data:{trackingId:id}},{onSuccess:result=>{queryClient.setQueryData(['public-order-tracking',result.trackingId],result);setActiveTrackingId(result.trackingId);}}); }
  return <PageShell><main className="mx-auto max-w-6xl px-5 pb-20 pt-8 md:px-10 md:pt-14">
    <section className="relative overflow-hidden bg-[#FFC400] px-6 py-10 md:px-12 md:py-14">
      <div className="absolute -right-12 -top-16 h-64 w-64 rounded-full border-[36px] border-black/[.06] md:right-10 md:top-[-70px] md:h-80 md:w-80"/>
      <p className="relative text-[10px] font-bold tracking-[.2em]">T-BEE ORDER DESK · BIRTAMODE</p>
      <h1 className="relative mt-5 max-w-[700px] font-display text-5xl font-bold leading-[.98] tracking-[-.08em] md:text-7xl">YOUR ORDER.<br/>YOUR NEXT MOVE.</h1>
      <p className="relative mt-5 max-w-md text-sm leading-6 text-black/70">Track every step from our door in Birtamode to yours.</p>
      <form onSubmit={submit} className="relative mt-8 flex max-w-xl flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="tracking-id">Tracking ID</label>
        <input id="tracking-id" value={trackingId} onChange={e=>setTrackingId(e.target.value.toUpperCase())} placeholder="ENTER TRACKING ID · T-BEE-XXXX000" className="h-14 min-w-0 flex-1 border border-black/20 bg-[#F5F3ED] px-4 font-display text-[13px] font-semibold tracking-[.06em] outline-none placeholder:text-black/40 focus:border-black" required data-testid="input-tracking-id"/>
        <Button type="submit" variant="black" disabled={track.isPending} className="h-14 px-7" testId="button-track-order">{track.isPending ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Search className="h-4 w-4"/>} TRACK ORDER <ArrowRight className="h-4 w-4"/></Button>
      </form>
    </section>
    {track.isPending && <div className="mt-8"><LoadingBlock message="Looking up your order"/></div>}
    {submitted && !activeTrackingId && track.isError && !track.isPending && <div className="mt-6 flex items-start gap-3 border border-[#a62720]/30 bg-[#f8e9e6] p-4 text-[#86281f]" role="alert" data-testid="status-track-error"><X className="mt-0.5 h-4 w-4"/><div><p className="text-sm font-bold">We couldn’t find that order.</p><p className="mt-1 text-xs">{errorText(track.error)}</p></div></div>}
    {order && !track.isPending && <div className="page-enter mt-8 grid gap-7 lg:grid-cols-[1.08fr_.92fr]">
      <section className="space-y-6">
        <div className="border border-black/10 bg-[#FBFAF6] p-5 md:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-bold tracking-[.17em] text-[#777]">TRACKING ID</p><p className="mt-1 font-display text-2xl font-bold tracking-[-.04em]" data-testid="text-tracking-id">{order.trackingId}</p></div><StatusPill status={order.status}/></div>
          <div className="mt-7 grid grid-cols-2 gap-4 border-y border-black/10 py-5 text-[12px]"><div><span className="text-[#777]">Placed</span><p className="mt-1 font-semibold">{date(order.createdAt)}</p></div><div><span className="text-[#777]">Delivery area</span><p className="mt-1 font-semibold">{order.deliveryOption === 'birtamode' ? 'Birtamode' : 'Outside Birtamode'}</p></div></div>
          <h2 className="mt-6 font-display text-sm font-bold tracking-[.05em]">ORDER PROGRESS</h2><Timeline order={order}/>
        </div>
        {order.deliveryMessage && <div className="border-l-4 border-[#FFC400] bg-[#fff8db] px-5 py-4"><p className="text-[9px] font-bold tracking-[.16em]">A NOTE ABOUT DELIVERY</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{order.deliveryMessage}</p>{order.deliveryMessageUpdatedAt && <p className="mt-2 text-[10px] text-[#777]">Updated {date(order.deliveryMessageUpdatedAt)}</p>}</div>}
        {!!order.deliveryContacts?.length && <section className="border border-black/10 bg-[#FBFAF6] p-5"><h2 className="font-display text-sm font-bold">DELIVERY CONTACT</h2><p className="mt-1 text-xs text-[#777]">Your delivery contact is ready when your order is out for delivery.</p><div className="mt-4 space-y-3">{order.deliveryContacts.map((person,index)=><div key={`${person.phone}-${index}`} className="flex items-center justify-between gap-3 border-t border-black/10 pt-3 text-sm"><div><p className="font-semibold">{person.name}</p><a className="text-xs text-[#777] underline" href={`tel:${person.phone}`}>{person.phone}</a></div><a href={person.whatsappUrl} target="_blank" rel="noreferrer" className="rounded-sm bg-[#111] px-3 py-2 text-[10px] font-bold tracking-wide text-white">WHATSAPP</a></div>)}</div></section>}
      </section>
      <aside className="space-y-5"><section className="border border-black/10 bg-[#FBFAF6] p-5 md:p-6"><div className="flex items-center justify-between"><h2 className="font-display text-sm font-bold">YOUR ITEMS</h2><span className="text-[10px] text-[#777]">{order.items.reduce((n,x)=>n+x.quantity,0)} PIECES</span></div>
        <div className="mt-4 divide-y divide-black/10">{order.items.map(item=><div key={item.id} className="flex gap-3 py-3"><div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden bg-[#EAE8E0]">{item.imageUrl ? <img src={item.imageUrl} alt={item.productName} className="h-full w-full object-cover"/> : <ShoppingBag className="h-5 w-5 text-black/30"/>}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.productName}</p><p className="mt-1 text-xs text-[#777]">Qty {item.quantity} · {money(item.unitPrice)} each</p></div><p className="text-xs font-semibold">{money(item.lineSubtotal)}</p></div>)}</div>
        <div className="mt-4 border-t border-black pt-4"><div className="flex items-end justify-between"><span className="text-xs text-[#777]">TOTAL PAID</span><span className="font-display text-2xl font-bold" data-testid="text-order-total">{money(order.finalTotal)}</span></div></div></section>
        <Invoice order={order} onDownload={()=>downloadInvoice(order)}/>
      </aside>
    </div>}
    <footer className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-black/10 pt-5 text-[10px] text-[#777]"><span>T-BEE CLOTHING · BIRTAMODE, NEPAL</span><span>BUILT FOR THE LONG WAY HOME.</span></footer>
  </main></PageShell>;
}

function LoginPage() {
  const [,setLocation]=useLocation(); const qc=useQueryClient(); const login=useAdminLogin();
  const [username,setUsername]=useState('');const [password,setPassword]=useState('');
  function submit(e: React.FormEvent){e.preventDefault();login.mutate({data:{username,password}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getGetAdminSessionQueryKey()});setLocation('/dashboard');}});}
  return <PageShell><main className="mx-auto grid min-h-[calc(100dvh-72px)] max-w-6xl items-center gap-12 px-5 py-12 md:grid-cols-[1fr_.85fr] md:px-10">
    <div className="max-w-lg"><p className="text-[10px] font-bold tracking-[.2em] text-[#8A6800]">T-BEE / ORDER DESK</p><h1 className="mt-5 font-display text-5xl font-bold leading-[.98] tracking-[-.08em] md:text-7xl">WELCOME<br/>BACK</h1><p className="mt-6 max-w-sm text-sm leading-6 text-[#777]">Sign in to continue.</p></div>
    <form onSubmit={submit} className="border border-black/10 bg-[#FBFAF6] p-6 md:p-9"><div className="mb-8 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center bg-[#FFC400]"><LockKeyhole className="h-5 w-5"/></div><div><p className="font-display text-lg font-bold">Sign in</p><p className="text-xs text-[#777]">Sign in to continue.</p></div></div>
       <div className="space-y-5"><Field label="Username" value={username} onChange={setUsername} required placeholder="Your username" autoComplete="username" testId="input-username"/><Field label="Password" value={password} onChange={setPassword} required type="password" placeholder="Your password" autoComplete="current-password" testId="input-password"/></div>
      {login.isError && <p className="mt-4 text-xs text-red-700" role="alert">{errorText(login.error)}</p>}<Button type="submit" className="mt-7 w-full" disabled={login.isPending} testId="button-login">{login.isPending ? <LoaderCircle className="h-4 w-4 animate-spin"/> : 'SIGN IN'} <ArrowRight className="h-4 w-4"/></Button>
    </form>
  </main></PageShell>;
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const session=useGetAdminSession();const [,setLocation]=useLocation();
  useEffect(()=>{if(session.data && !session.data.authenticated && !session.isFetching)setLocation('/login');},[session.data,session.isFetching,setLocation]);
  if(session.isLoading || session.isFetching)return <PageShell><main className="mx-auto max-w-7xl px-5 py-12"><LoadingBlock message="Checking access"/></main></PageShell>;
  if(session.isError){return <PageShell><main className="mx-auto max-w-xl px-5 py-20 text-center"><ShieldCheck className="mx-auto h-8 w-8"/><h1 className="mt-4 font-display text-2xl font-bold">Access check unavailable</h1><p className="mt-2 text-sm text-[#777]">{errorText(session.error)}</p><Button className="mt-5" onClick={()=>session.refetch()} testId="button-retry-session">TRY AGAIN</Button></main></PageShell>;}
  if(!session.data?.authenticated)return null;
  return <>{children}</>;
}

function AdminFrame({ children, title, kicker, action }: {children:React.ReactNode;title:string;kicker:string;action?:React.ReactNode}) {
  const logout=useAdminLogout();const qc=useQueryClient();const [,setLocation]=useLocation();
  return <PageShell><main className="mx-auto max-w-7xl px-5 pb-16 pt-8 md:px-10 md:pt-12"><div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-black/15 pb-6"><div><p className="text-[10px] font-bold tracking-[.18em] text-[#8A6800]">{kicker}</p><h1 className="mt-2 font-display text-4xl font-bold tracking-[-.07em] md:text-5xl">{title}</h1></div><div className="flex gap-2">{action}<Button variant="line" onClick={()=>logout.mutate(undefined,{onSuccess:()=>{qc.invalidateQueries({queryKey:getGetAdminSessionQueryKey()});setLocation('/login');}})} disabled={logout.isPending} testId="button-logout"><LogOut className="h-4 w-4"/> SIGN OUT</Button></div></div>{children}</main></PageShell>;
}

function StatCard({ label, value, detail, dark = false }: {label:string;value:string|number;detail:string;dark?:boolean}) {
  return <article className={`relative min-h-[128px] overflow-hidden p-5 ${dark?'bg-[#111] text-[#F5F3ED]':'border border-black/10 bg-[#FBFAF6]'}`}><p className={`text-[9px] font-bold tracking-[.16em] ${dark?'text-white/50':'text-[#777]'}`}>{label}</p><p className="mt-3 font-display text-3xl font-bold tracking-[-.06em]" data-testid={`stat-${label.toLowerCase().replaceAll(' ','-')}`}>{value}</p><p className={`mt-1 text-[10px] ${dark?'text-white/50':'text-[#777]'}`}>{detail}</p>{dark&&<div className="absolute -bottom-8 -right-4 h-24 w-24 rotate-45 bg-[#FFC400]"/>}</article>;
}

function DashboardPage() {
  const dashboard=useGetAdminDashboard(); const [search,setSearch]=useState(''); const [status,setStatus]=useState('');
  const params=useMemo(()=>({...(search.trim()?{search:search.trim()}:{}),...(status?{status:status as OrderStatus}:{})}),[search,status]);
  const list=useListAdminOrders(params,{query:{queryKey:getListAdminOrdersQueryKey(params)}});
  const [,setLocation]=useLocation();
  return <AdminFrame kicker="T-BEE / ORDER DESK" title="Order overview" action={<Button onClick={()=>setLocation('/create-order')} testId="button-create-order"><Package className="h-4 w-4"/> NEW ORDER</Button>}>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {dashboard.isLoading ? Array.from({length:6},(_,i)=><div key={i} className="h-32 animate-pulse bg-black/[.06]"/>) : dashboard.isError ? <div className="col-span-full border border-red-300 bg-red-50 p-4 text-sm text-red-800">Dashboard unavailable. <button className="ml-2 underline" onClick={()=>dashboard.refetch()}>Retry</button></div> : <>
        <StatCard label="TOTAL ORDERS" value={dashboard.data?.totalOrders ?? 0} detail="All orders created"/>
        <StatCard label="NEEDS ATTENTION" value={dashboard.data?.pending ?? 0} detail="Pending verification"/>
        <StatCard label="IN PREPARATION" value={dashboard.data?.processing ?? 0} detail="Processing now"/>
        <StatCard label="ON THE WAY" value={dashboard.data?.outForDelivery ?? 0} detail="Out for delivery"/>
        <StatCard label="DELIVERED" value={dashboard.data?.delivered ?? 0} detail={`${dashboard.data?.cancelled ?? 0} cancelled`}/>
        <StatCard label="DELIVERED SALES" value={money(dashboard.data?.deliveredSales ?? 0)} detail="Completed orders only" dark/>
      </>}
    </div>
    <section className="mt-10">
      <div className="mb-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-[10px] font-bold tracking-[.16em] text-[#777]">LIVE REGISTER</p><h2 className="mt-1 font-display text-2xl font-bold tracking-[-.05em]">Orders</h2></div>
        <div className="flex flex-col gap-2 sm:flex-row"><label className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#777]"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name or tracking ID" className="h-11 w-full border border-black/15 bg-[#FBFAF6] pl-9 pr-3 text-sm outline-none focus:border-black sm:w-64" data-testid="input-order-search"/></label><select value={status} onChange={e=>setStatus(e.target.value)} className="h-11 border border-black/15 bg-[#FBFAF6] px-3 text-sm outline-none focus:border-black" aria-label="Filter orders by status" data-testid="select-order-status"><option value="">All statuses</option>{statuses.map(s=><option value={s} key={s}>{labels[s]}</option>)}</select></div>
      </div>
      <div className="overflow-hidden border border-black/10 bg-[#FBFAF6]">
        {list.isLoading ? <div className="space-y-2 p-5">{[1,2,3].map(x=><div key={x} className="h-14 animate-pulse bg-black/[.05]"/>)}</div> : list.isError ? <div className="p-8 text-center"><p className="text-sm font-semibold">Orders didn’t load.</p><p className="mt-1 text-xs text-[#777]">{errorText(list.error)}</p><Button className="mt-4" onClick={()=>list.refetch()} testId="button-retry-orders">RETRY</Button></div> : !(list.data?.length) ? <div className="p-12 text-center"><Package className="mx-auto h-8 w-8 text-[#999]"/><p className="mt-3 font-display text-lg font-bold">Nothing in this view</p><p className="mt-1 text-xs text-[#777]">Try another search or create a new order.</p><Button className="mt-4" onClick={()=>setLocation('/create-order')}>CREATE ORDER</Button></div> : <div className="overflow-x-auto"><table className="w-full min-w-[690px] text-left"><thead className="bg-[#eeeae0] text-[9px] font-bold tracking-[.14em] text-[#777]"><tr><th className="px-5 py-3">ORDER / CUSTOMER</th><th className="px-4 py-3">PLACED</th><th className="px-4 py-3">STATUS</th><th className="px-4 py-3 text-center">ITEMS</th><th className="px-5 py-3 text-right">TOTAL</th><th className="px-3 py-3"/></tr></thead><tbody className="divide-y divide-black/[.08]">{list.data.map((order:AdminOrderSummary)=><tr key={order.trackingId} className="transition-colors hover:bg-[#FFC400]/10" data-testid={`row-order-${order.trackingId}`}><td className="px-5 py-4"><Link href={`/orders/${order.trackingId}`} className="font-display text-[13px] font-bold underline decoration-[#FFC400] decoration-2 underline-offset-2">{order.trackingId}</Link><p className="mt-1 text-xs">{order.customerName}</p></td><td className="px-4 py-4 text-xs text-[#777]">{date(order.createdAt)}</td><td className="px-4 py-4"><StatusPill status={order.status}/></td><td className="px-4 py-4 text-center text-xs">{order.itemCount}</td><td className="px-5 py-4 text-right text-xs font-bold">{money(order.finalTotal)}</td><td className="px-3 py-4"><Link href={`/orders/${order.trackingId}`} aria-label={`Open order ${order.trackingId}`} className="inline-flex h-8 w-8 items-center justify-center hover:bg-[#FFC400]" data-testid={`link-order-${order.trackingId}`}><ArrowUpRight className="h-4 w-4"/></Link></td></tr>)}</tbody></table></div>}
      </div>
    </section>
  </AdminFrame>;
}

type DraftProduct = { productName:string;quantity:string;unitPrice:string;imagePath:string;preview?:string };
const emptyProduct=():DraftProduct=>({productName:'',quantity:'1',unitPrice:'',imagePath:''});

function OrderEditor({ edit=false }: {edit?:boolean}) {
  const params=useParams<{trackingId:string}>();const trackingId=params.trackingId ?? '';
  const existing=useGetAdminOrder(trackingId,{query:{enabled:edit && !!trackingId,queryKey:getGetAdminOrderQueryKey(trackingId)}});
  const newId=useGetNewTrackingId({query:{enabled:!edit,queryKey:getGetNewTrackingIdQueryKey()}});
  const create=useCreateAdminOrder();const update=useUpdateAdminOrder();const upload=useRequestOrderImageUpload();const qc=useQueryClient();const [,setLocation]=useLocation();
  const [name,setName]=useState(''),[phone,setPhone]=useState(''),[address,setAddress]=useState(''),[landmark,setLandmark]=useState(''),[delivery,setDelivery]=useState<'birtamode'|'outside_birtamode'>('birtamode'),[discount,setDiscount]=useState('0'),[message,setMessage]=useState(''),[items,setItems]=useState<DraftProduct[]>([emptyProduct()]),[toast,setToast]=useState('');
  const order=existing.data as AdminOrder|undefined;
  useEffect(()=>{if(order){setName(order.customerName);setPhone(order.customerPhone);setAddress(order.deliveryAddress);setLandmark(order.landmark||'');setDelivery(order.deliveryOption);setDiscount(String(order.discountAmount));setMessage(order.deliveryMessage||'');setItems(order.items.map(i=>({productName:i.productName,quantity:String(i.quantity),unitPrice:String(i.unitPrice),imagePath:i.imageUrl?.startsWith('/api/storage/')?i.imageUrl.slice('/api/storage'.length):i.imageUrl||'',preview:i.imageUrl||undefined})));}},[order]);
  const previewSubtotal=items.reduce((sum,i)=>sum+(Number(i.quantity)||0)*(Number(i.unitPrice)||0),0);
  const previewDelivery=edit ? (order?.deliveryCharge ?? 0) : 0;
  const previewTotal=Math.max(0,previewSubtotal+previewDelivery-(Number(discount)||0));
  function changeItem(index:number,key:keyof DraftProduct,value:string){setItems(curr=>curr.map((x,i)=>i===index?{...x,[key]:value}:x));}
  async function uploadImage(index:number,file?:File){
    if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)){setToast('Use a JPG, PNG or WebP image.');return;}if(file.size>5*1024*1024){setToast('Image must be 5 MB or smaller.');return;}
    try{const result=await upload.mutateAsync({data:{name:file.name,size:file.size,contentType:file.type as 'image/jpeg'|'image/png'|'image/webp'}});const response=await fetch(result.uploadURL,{method:'PUT',headers:{'Content-Type':file.type},body:file});if(!response.ok)throw new Error('Image upload did not finish.');setItems(curr=>curr.map((x,i)=>i===index?{...x,imagePath:result.objectPath,preview:URL.createObjectURL(file)}:x));setToast('Product image uploaded.');}catch(e){setToast(errorText(e));}
  }
  function submit(e:React.FormEvent){
    e.preventDefault();setToast('');
    const productInputs:ProductInput[]=items.map(x=>({productName:x.productName.trim(),quantity:Number(x.quantity),unitPrice:Number(x.unitPrice),...(x.imagePath?{imagePath:x.imagePath}:{})}));
    if(productInputs.some(x=>!x.productName||x.quantity<1||x.unitPrice<0)){setToast('Check product names, quantities and prices.');return;}
    if(edit){update.mutate({trackingId,data:{customerName:name,customerPhone:phone,deliveryAddress:address,landmark:landmark||null,items:productInputs,deliveryOption:delivery,discountAmount:Number(discount)||0,deliveryMessage:message||null}},{onSuccess:async()=>{await Promise.all([qc.invalidateQueries({queryKey:getGetAdminOrderQueryKey(trackingId)}),qc.invalidateQueries({queryKey:getGetAdminDashboardQueryKey()}),qc.invalidateQueries({queryKey:getListAdminOrdersQueryKey()})]);setToast('Order details saved.');}});}
    else{create.mutate({data:{customerName:name,customerPhone:phone,deliveryAddress:address,landmark,items:productInputs,deliveryOption:delivery,discountAmount:Number(discount)||0,deliveryMessage:message}},{onSuccess:async created=>{await Promise.all([qc.invalidateQueries({queryKey:getGetAdminDashboardQueryKey()}),qc.invalidateQueries({queryKey:getListAdminOrdersQueryKey()})]);setLocation(`/orders/${created.trackingId}`);}});}
  }
  if(edit && existing.isLoading)return <AdminFrame kicker="ORDER RECORD" title="Loading order"><LoadingBlock/></AdminFrame>;
  if(edit && existing.isError)return <AdminFrame kicker="ORDER RECORD" title="Order unavailable"><p className="text-sm">{errorText(existing.error)}</p><Button className="mt-4" onClick={()=>existing.refetch()}>RETRY</Button></AdminFrame>;
  const busy=create.isPending||update.isPending;
  return <AdminFrame kicker={edit?'ORDER RECORD / EDIT':'ORDER DESK / NEW ORDER'} title={edit?'Edit order':'Create order'} action={<Button variant="line" onClick={()=>setLocation(edit?`/orders/${trackingId}`:'/dashboard')}><ArrowLeft className="h-4 w-4"/> BACK</Button>}>
    <form onSubmit={submit} className="grid items-start gap-7 xl:grid-cols-[1fr_330px]">
      <div className="space-y-6">
        <section className="border border-black/10 bg-[#FBFAF6] p-5 md:p-7"><div className="mb-6 flex items-center justify-between border-b border-black/10 pb-4"><div><p className="text-[9px] font-bold tracking-[.16em] text-[#777]">01 / CUSTOMER</p><h2 className="mt-1 font-display text-xl font-bold">Who’s it for?</h2></div><div className="flex items-center gap-2"><span className="font-display text-[11px] font-bold">{edit?trackingId:newId.data?.trackingId ?? 'Generating ID…'}</span>{!edit&&<Button variant="quiet" className="min-h-8 px-2" disabled={!newId.data?.trackingId} onClick={()=>{void navigator.clipboard.writeText(newId.data?.trackingId||'').then(()=>setToast('Tracking ID copied.'));}} testId="button-copy-tracking-id"><Copy className="h-3.5 w-3.5"/> COPY</Button>}</div></div><div className="grid gap-4 md:grid-cols-2"><Field label="Customer name" value={name} onChange={setName} required placeholder="Full name"/><Field label="Phone number" value={phone} onChange={setPhone} required placeholder="+977 98…"/><div className="md:col-span-2"><Field label="Delivery address" value={address} onChange={setAddress} required multiline placeholder="Town, ward and street"/><p className="mt-1 text-[11px] text-[#777]" lang="ne">नेपाली ठेगाना पनि लेख्न सक्नुहुन्छ।</p></div><Field label="Landmark" value={landmark} onChange={setLandmark} placeholder="Optional nearby place"/><label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-[#777]">Delivery area</span><select value={delivery} onChange={e=>setDelivery(e.target.value as 'birtamode'|'outside_birtamode')} className="w-full rounded-sm border border-black/15 bg-[#FBFAF6] px-3.5 py-3 text-sm outline-none focus:border-black"><option value="birtamode">Birtamode</option><option value="outside_birtamode">Outside Birtamode</option></select></label></div></section>
        <section className="border border-black/10 bg-[#FBFAF6] p-5 md:p-7"><div className="mb-6 flex items-center justify-between border-b border-black/10 pb-4"><div><p className="text-[9px] font-bold tracking-[.16em] text-[#777]">02 / PRODUCTS</p><h2 className="mt-1 font-display text-xl font-bold">What are they getting?</h2></div><Button variant="line" onClick={()=>setItems(curr=>[...curr,emptyProduct()])} testId="button-add-product">+ ADD ITEM</Button></div>
          <div className="space-y-4">{items.map((item,index)=><article key={index} className="relative border border-black/10 p-4"><div className="mb-4 flex items-center justify-between"><p className="text-[10px] font-bold tracking-[.13em] text-[#777]">PRODUCT {String(index+1).padStart(2,'0')}</p>{items.length>1&&<button type="button" className="p-1 text-[#777] hover:text-red-700" onClick={()=>setItems(curr=>curr.filter((_,i)=>i!==index))} aria-label="Remove product"><X className="h-4 w-4"/></button>}</div><div className="grid gap-3 sm:grid-cols-[1fr_90px_130px]"><Field label="Product name" value={item.productName} onChange={v=>changeItem(index,'productName',v)} required placeholder="Classic box tee"/><Field label="Qty" value={item.quantity} onChange={v=>changeItem(index,'quantity',v)} required type="number"/><Field label="Unit price" value={item.unitPrice} onChange={v=>changeItem(index,'unitPrice',v)} required type="number" hint="NPR"/></div><div className="mt-3 flex items-center gap-3"><label className="inline-flex cursor-pointer items-center gap-2 border border-black/15 px-3 py-2 text-[10px] font-bold tracking-wide hover:bg-[#FFC400]/20"><ImagePlus className="h-4 w-4"/> {upload.isPending?'UPLOADING…':'ADD PRODUCT IMAGE'}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={upload.isPending} onChange={e=>{void uploadImage(index,e.target.files?.[0]);e.currentTarget.value='';}}/></label>{item.preview&&<img src={item.preview} alt="Product preview" className="h-11 w-11 object-cover"/>}</div></article>)}</div>
        </section>
        <section className="border border-black/10 bg-[#FBFAF6] p-5 md:p-7"><p className="text-[9px] font-bold tracking-[.16em] text-[#777]">03 / HAND-OFF</p><h2 className="mt-1 font-display text-xl font-bold">Delivery note</h2><div className="mt-5"><Field label="Message to customer" value={message} onChange={setMessage} multiline placeholder="Keep every line break as written." hint="This message appears on the public tracking page."/></div></section>
      </div>
      <aside className="space-y-4 xl:sticky xl:top-24">
        <section className="border border-black/10 bg-[#FBFAF6] p-5"><p className="text-[9px] font-bold tracking-[.16em] text-[#777]">ORDER SUMMARY</p><h2 className="mt-1 font-display text-xl font-bold">The numbers</h2><div className="mt-5 space-y-3 text-[12px]"><div className="flex justify-between"><span className="text-[#777]">Items subtotal</span><span>{money(previewSubtotal)}</span></div><div className="flex justify-between"><span className="text-[#777]">Delivery{!edit?' (server-calculated)':''}</span><span>{edit ? money(previewDelivery) : 'Server-calculated'}</span></div><Field label="Discount" value={discount} onChange={setDiscount} type="number" hint="NPR, applied by server"/><div className="flex justify-between border-t border-black pt-4 font-bold"><span>{edit?'ESTIMATED TOTAL':'ITEMS ESTIMATE'}</span><span className="font-display text-lg">{money(previewTotal)}</span></div><p className="text-[10px] leading-4 text-[#777]">Final total and delivery charge are confirmed by the server.</p></div></section>
        {toast&&<p className="border border-[#b39028]/30 bg-[#fff5cc] p-3 text-xs" role="status">{toast}</p>}
        {create.isError&&<p className="text-xs text-red-700" role="alert">{errorText(create.error)}</p>}{update.isError&&<p className="text-xs text-red-700" role="alert">{errorText(update.error)}</p>}
        <Button type="submit" onClick={()=>{}} disabled={busy||upload.isPending} className="w-full" testId="button-save-order">{busy?<LoaderCircle className="h-4 w-4 animate-spin"/>:<Check className="h-4 w-4"/>}{edit?'SAVE CHANGES':'CREATE ORDER'}</Button>
        {newId.isError&&!edit&&<p className="text-xs text-red-700">Tracking ID unavailable. <button type="button" className="underline" onClick={()=>newId.refetch()}>Retry</button></p>}
      </aside>
    </form>
  </AdminFrame>;
}

function OrderDetailPage() {
  const {trackingId=''}=useParams<{trackingId:string}>();const orderQuery=useGetAdminOrder(trackingId,{query:{queryKey:getGetAdminOrderQueryKey(trackingId)}});const order=orderQuery.data as AdminOrder|undefined;
  const statusUpdate=useUpdateAdminOrderStatus();const archive=useDeleteAdminOrder();const qc=useQueryClient();const [,setLocation]=useLocation();const [status,setStatus]=useState<OrderStatus>('pending');
  useEffect(()=>{if(order)setStatus(order.status);},[order]);
  async function refresh(){await Promise.all([qc.invalidateQueries({queryKey:getGetAdminOrderQueryKey(trackingId)}),qc.invalidateQueries({queryKey:getGetAdminDashboardQueryKey()}),qc.invalidateQueries({queryKey:getListAdminOrdersQueryKey()})]);}
  if(orderQuery.isLoading)return <AdminFrame kicker="ORDER RECORD" title="Loading"><LoadingBlock/></AdminFrame>;
  if(orderQuery.isError||!order)return <AdminFrame kicker="ORDER RECORD" title="Order unavailable"><p className="text-sm">{orderQuery.error?errorText(orderQuery.error):'No order found.'}</p><Button className="mt-4" onClick={()=>orderQuery.refetch()}>RETRY</Button></AdminFrame>;
  return <AdminFrame kicker="ORDER RECORD / PRIVATE" title={order.trackingId} action={<Button variant="line" onClick={()=>setLocation(`/orders/${trackingId}/edit`)} testId="button-edit-order">EDIT ORDER</Button>}>
    <div className="grid gap-7 lg:grid-cols-[1fr_360px]"><section className="space-y-5">
      <div className="border border-black/10 bg-[#FBFAF6] p-5 md:p-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[9px] font-bold tracking-[.15em] text-[#777]">CUSTOMER</p><h2 className="mt-1 font-display text-2xl font-bold">{order.customerName}</h2><a className="mt-1 inline-block text-sm underline decoration-[#FFC400] decoration-2 underline-offset-2" href={`tel:${order.customerPhone}`}>{order.customerPhone}</a></div><StatusPill status={order.status}/></div><div className="mt-6 grid gap-4 border-t border-black/10 pt-5 sm:grid-cols-2"><div><p className="text-[9px] font-bold tracking-[.13em] text-[#777]">DELIVER TO</p><p className="mt-1 whitespace-pre-wrap text-sm">{order.deliveryAddress}</p>{order.landmark&&<p className="mt-1 text-xs text-[#777]">Near {order.landmark}</p>}</div><div><p className="text-[9px] font-bold tracking-[.13em] text-[#777]">PLACED</p><p className="mt-1 text-sm">{date(order.createdAt)}</p><p className="mt-2 text-xs text-[#777]">{order.deliveryOption==='birtamode'?'Birtamode delivery':'Outside Birtamode'}</p></div></div></div>
      <div className="border border-black/10 bg-[#FBFAF6] p-5 md:p-7"><h2 className="font-display text-lg font-bold">Product lines</h2><div className="mt-3 divide-y divide-black/10">{order.items.map(item=><div key={item.id} className="flex items-center gap-3 py-3">{item.imageUrl?<img src={item.imageUrl} alt={item.productName} className="h-14 w-14 object-cover"/>:<div className="flex h-14 w-14 items-center justify-center bg-[#EAE8E0]"><ShoppingBag className="h-5 w-5 text-black/30"/></div>}<div className="flex-1"><p className="font-semibold">{item.productName}</p><p className="text-xs text-[#777]">{item.quantity} × {money(item.unitPrice)}</p></div><p className="text-sm font-bold">{money(item.lineSubtotal)}</p></div>)}</div><div className="mt-4 border-t border-black/15 pt-4"><p className="whitespace-pre-wrap text-sm">{order.deliveryMessage||'No delivery note.'}</p></div></div>
      <section className="border border-black/10 bg-[#FBFAF6] p-5 md:p-7"><h2 className="font-display text-lg font-bold">Status history</h2><Timeline order={order}/></section>
    </section><aside className="space-y-5"><section className="border border-black/10 bg-[#FBFAF6] p-5"><p className="text-[9px] font-bold tracking-[.15em] text-[#777]">UPDATE STATUS</p><select value={status} onChange={e=>setStatus(e.target.value as OrderStatus)} className="mt-3 w-full border border-black/15 bg-[#F5F3ED] p-3 text-sm">{statuses.map(s=><option value={s} key={s}>{labels[s]}</option>)}</select><Button className="mt-3 w-full" disabled={status===order.status||statusUpdate.isPending} onClick={()=>statusUpdate.mutate({trackingId,data:{status}},{onSuccess:refresh})} testId="button-update-status">{statusUpdate.isPending?<LoaderCircle className="h-4 w-4 animate-spin"/>:'UPDATE STATUS'}</Button>{statusUpdate.isError&&<p className="mt-2 text-xs text-red-700">{errorText(statusUpdate.error)}</p>}</section>
      <Invoice order={order} onDownload={()=>downloadInvoice(order)}/>
      <Button variant="danger" className="w-full" disabled={archive.isPending} onClick={()=>{if(window.confirm(`Archive order ${order.trackingId}?`))archive.mutate({trackingId},{onSuccess:async()=>{await refresh();setLocation('/dashboard');}});}} testId="button-archive-order">{archive.isPending?<LoaderCircle className="h-4 w-4 animate-spin"/>:<Package className="h-4 w-4"/>} ARCHIVE ORDER</Button>{archive.isError&&<p className="text-xs text-red-700">{errorText(archive.error)}</p>}
    </aside></div>
  </AdminFrame>;
}

function Protected({ children }: {children:React.ReactNode}) { return <AuthGate>{children}</AuthGate>; }

function Router() {
  return <ErrorBoundary><Switch>
    <Route path="/" component={TrackPage}/>
    <Route path="/login" component={LoginPage}/>
    <Route path="/dashboard"><Protected><DashboardPage/></Protected></Route>
    <Route path="/create-order"><Protected><OrderEditor/></Protected></Route>
    <Route path="/orders/:trackingId/edit"><Protected><OrderEditor edit/></Protected></Route>
    <Route path="/orders/:trackingId"><Protected><OrderDetailPage/></Protected></Route>
    <Route component={NotFound}/>
  </Switch></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/,'')}><Router/></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>;
}

export default App;
