import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { chromium, expect } from '@playwright/test';

const source = fs.readFileSync('artifacts/erp-ui/src/lib/invoice-totals.ts', 'utf8');
const { invoiceTotals } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpile(source, {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
})).toString('base64'));
const item = (price, qty = 1) => ({ qty, unit_price: price, tax_rate: 16 });
assert.deepEqual(invoiceTotals([item(1160)], 'combined', 16, true, []), { subtotal: 1000, taxTotal: 160, chargeTotal: 0, total: 1160 });
assert.deepEqual(invoiceTotals([item(100)], 'combined', 16, true, []), { subtotal: 86.21, taxTotal: 13.79, chargeTotal: 0, total: 100 });
assert.deepEqual(invoiceTotals([item(1160)], 'combined', 16, false, []), { subtotal: 1160, taxTotal: 185.6, chargeTotal: 0, total: 1345.6 });
assert.deepEqual(invoiceTotals([item(1160)], 'combined', 16, true, [
  {calculation_type:'percentage', rate:2}, {calculation_type:'fixed', rate:50},
]), { subtotal:1000, taxTotal:160, chargeTotal:70, total:1230 });
assert.equal(invoiceTotals([item(.01, .5)], 'combined', 0, true, []).total, 0);
assert.equal(invoiceTotals([item(.03, .5)], 'combined', 0, true, []).total, .02);
assert.deepEqual(invoiceTotals([item(.01, .333), item(.01, .333)], 'combined',16,true,[]), {subtotal:.01,taxTotal:0,chargeTotal:0,total:.01});
assert.equal(invoiceTotals([item(100)], 'per_line', 16, false, []).total, 116);
assert.deepEqual(invoiceTotals([item(1160)], 'combined', 16, true, [
  {calculation_type:'percentage',rate:-2}, {calculation_type:'fixed',rate:-50},
]), {subtotal:1000,taxTotal:160,chargeTotal:-70,total:1090});
assert.doesNotThrow(()=>invoiceTotals([item(1e25)], 'combined', Infinity, true, []));
console.log('PASS inclusive/exclusive preview, charges, fractional quantities and half-even rounding');

fs.mkdirSync('tmp/invoice-tax', {recursive:true});
const libraries = process.cwd() + '/tmp/workspace-ui/linux-libs/usr/lib/x86_64-linux-gnu';
if (fs.existsSync(libraries)) process.env.LD_LIBRARY_PATH = [libraries, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
const browser = await chromium.launch({headless:true});
const user = {id:42, username:'ui.admin', first_name:'UI',last_name:'Tester',organization_id:1,tenant_id:1,organization_name:'Demo Organization',organization_code:'demo',branch_id:1,is_tenant_admin:true,active_role:'tenant_admin',permissions:[],memberships:[]};
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5193';
try {
  for (const viewport of [{width:1440,height:1000}, {width:390,height:844}]) {
    const context = await browser.newContext({viewport});
    const writes = [], errors = [];
    let invoice = {
      id:9,invoice_number:'INV-2026-0009',customer:1,customer_name:'Tax Customer',tenant:1,status:'draft',source_module:'manual',currency:'KES',
      invoice_date:'2026-11-11',due_date:null,notes:'',can_edit:true,can_edit_items:true,prices_include_tax:true,tax_mode:'combined',combined_tax_name:'VAT',combined_tax_rate:16,
      subtotal_amount:1000,tax_total:160,charge_total:0,total_amount:1160,
      lines:[{id:1,product:null,product_name:'',description:'Service',quantity:1,unit_price:1160,net_unit_price:1000,tax_rate:0,tax_amount:0,total:1000}],charges:[],transactions:[],
    };
    await context.addInitScript(user => {
      localStorage.setItem('sl-erp-token','ui-test-token');
      localStorage.setItem('sl-erp-user',JSON.stringify(user));
      localStorage.setItem('sl-erp-last-activity',String(Date.now()));
    },user);
    await context.route('**/api/**',async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      let data = {data:{},results:[],count:0,summary:{},settings:{},branches:[],transactions:[],invoices:[],tasks:[],projects:[]};
      if (path.endsWith('/auth/me/')) data=user;
      else if (path.includes('/tenants/self/')) data={id:1,name:'Demo Organization',code:'demo',timezone:'Africa/Nairobi'};
      else if (path.includes('/tenants/1/settings/')) data={primary_color:'#2563eb',default_tax_name:'VAT',default_tax_rate:16};
      else if (path.includes('/workspace/navigation/')) data={active_module_slugs:['invoicing','sales'],sections:[{key:'finance',title:'Finance',items:[{title:'Invoices',path:'/payments/invoices'}]}]};
      else if (path.includes('/public/site/')) data={tenant:{id:1,name:'Demo Organization',code:'demo'},branding:{primary_color:'#2563eb'},settings:{}};
      else if (path==='/api/payments/customers/') data={results:[{id:1,name:'Tax Customer',address:'Nairobi'}]};
      else if (path==='/api/sales/products/') data={results:[]};
      else if (path==='/api/sales/charges/' || path==='/api/payments/payment-methods/' || path==='/api/payments/methods/') data=[];
      else if (path==='/api/payments/invoices/') {
        if (req.method()==='POST') {writes.push(req.postDataJSON());data=invoice;} else data={results:[],count:0};
      }
      else if (path==='/api/payments/invoices/9/') {
        if(req.method()==='PATCH') {
          const body=req.postDataJSON(); writes.push(body);
          if(body.line_items) {
            const totals=invoiceTotals(body.line_items,body.tax_mode,body.combined_tax_rate,body.prices_include_tax,[]);
            invoice={...invoice,prices_include_tax:body.prices_include_tax,tax_mode:body.tax_mode,combined_tax_rate:body.combined_tax_rate,subtotal_amount:totals.subtotal,tax_total:totals.taxTotal,total_amount:totals.total};
          }
          invoice={...invoice,notes:body.notes ?? invoice.notes};
        }
        data=invoice;
      }
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
    page.setDefaultTimeout(15000);
    const active=()=>page.locator('[data-workspace-tab-panel]:visible');
    const clickAction=async name => {
      const button=page.getByRole('button',{name,exact:true});
      const more=active().getByRole('button',{name:'More table tools',exact:true});
      await expect.poll(async()=>await button.isVisible() || await more.isVisible(),{timeout:30000}).toBe(true);
      if (!await button.isVisible()) await more.click();
      await button.click();
    };
    const summary=()=>active().getByRole('heading',{name:'Invoice summary'}).locator('..');
    const expectTotal=async(label,amount)=>expect(summary().locator('dl > div').filter({has:page.getByText(label,{exact:true})}).getByRole('definition')).toHaveText('KES '+amount);
    await page.goto(base+'/payments/invoices',{waitUntil:'domcontentloaded',timeout:60000});
    await clickAction('New Invoice');
    await active().getByRole('button',{name:'Tax Customer',exact:true}).click();
    await active().getByLabel('Description',{exact:true}).fill('Service');
    await active().getByLabel('Unit price',{exact:true}).fill('1160');
    await active().getByLabel('Tax method',{exact:true}).click();
    await page.getByRole('option',{name:'Combined invoice tax',exact:true}).click();
    await active().getByLabel('VAT rate (%)',{exact:true}).fill('16');
    await active().getByLabel('Tax treatment',{exact:true}).click();
    await page.getByRole('option',{name:'Prices include tax',exact:true}).click();
    await expectTotal('Subtotal (excl. tax)','1,000.00');
    await expectTotal('Tax included','160.00');
    await expectTotal('Grand total','1,160.00');
    const geometry=await active().getByLabel('Tax treatment',{exact:true}).boundingBox();
    assert.ok(geometry && geometry.width>100 && geometry.x+geometry.width<=viewport.width,'Tax treatment fits viewport');
    await expect(active().getByLabel('Description',{exact:true})).toHaveValue('Service');
    await page.screenshot({path:'tmp/invoice-tax/inclusive-'+viewport.width+'.png',fullPage:true});
    await active().getByRole('button',{name:'Create Invoice',exact:true}).click();
    await expect.poll(()=>writes.length).toBe(1);
    assert.equal(writes[0].prices_include_tax,true);
    assert.equal(writes[0].line_items[0].unit_price,1160);
    await active().getByRole('heading',{name:'INV-2026-0009',exact:true}).waitFor();
    await expect(active().getByRole('definition').filter({hasText:'KES 160.00'})).toHaveCount(1);
    await clickAction('Edit invoice');
    await expect(active().getByLabel('Tax treatment',{exact:true})).toHaveText('Prices include tax');
    await expect(active().getByLabel('Unit price (incl. tax)',{exact:true})).toHaveValue('1160');
    await active().getByLabel('Notes',{exact:true}).fill('Contact details only');
    await active().getByRole('button',{name:'Save changes',exact:true}).click();
    await expect.poll(()=>writes.length).toBe(2);
    assert.equal('prices_include_tax' in writes[1],false,'Metadata edits do not recalculate finances');
    await clickAction('Edit invoice');
    await active().getByLabel('Quantity',{exact:true}).fill('2');
    await expectTotal('Grand total','2,320.00');
    await active().getByRole('button',{name:'Save changes',exact:true}).click();
    await expect.poll(()=>writes.length).toBe(3);
    assert.equal(writes[2].prices_include_tax,true);
    assert.equal(writes[2].line_items[0].qty,2);
    assert.equal(writes[2].line_items[0].unit_price,1160);
    assert.deepEqual(errors,[]);
    await context.close();
    console.log('PASS invoice creation, persisted tax treatment and safe editing at '+viewport.width+'px');
  }
} finally { await browser.close(); }
