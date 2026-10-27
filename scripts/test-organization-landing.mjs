import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
const modules = new Map();
function moduleUrl(name) {
  if(modules.has(name)) return modules.get(name);
  const source = readFileSync(new URL(`../artifacts/erp-ui/src/lib/${name}.ts`, import.meta.url),'utf8');
  let js = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
  js = js.replace(/from ['"]@\/lib\/([^'"]+)['"]/g,(_,dependency)=>`from '${moduleUrl(dependency)}'`);
  const url = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
  modules.set(name,url);return url;
}
const { organizationLandingPath } = await import(moduleUrl('organization-landing'));
test('own-task roles land on their permitted project dashboard after switching',()=>{
 const path=organizationLandingPath({active_role:'Task member',permissions:['SL_Projects.view_own_projecttask']},{active_module_slugs:['projects-tasks'],sections:[]});
 assert.equal(path,'/projects/overview');
});
test('an unlicensed project module is not chosen for landing',()=>{
 assert.equal(organizationLandingPath({active_role:'Task member',permissions:['SL_Projects.view_own_projecttask']},{active_module_slugs:[],sections:[]}),'/dashboard');
});
test('department leaders land in their requisition workspace',()=>{
 assert.equal(organizationLandingPath({active_role:'Supervisor',permissions:['SL_Procurement.view_requisition']},{active_module_slugs:['procurement'],sections:[]}),'/procurement/requisitions');
});
test('organization administrators retain the common dashboard',()=>{
 assert.equal(organizationLandingPath({active_role:'owner',is_org_admin:true,permissions:[]},{}),'/dashboard');
});
