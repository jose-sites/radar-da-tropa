import {appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// Deployment is limited to the existing project and its known public address.
export function projectConfiguration(data) {
  const project=data?.result;
  if (data?.success!==true || project?.name!=='radardatropa' || project?.subdomain!=='radardatropa.pages.dev')
    throw new Error('O projeto existente radardatropa.pages.dev não foi encontrado nesta conta. Nenhum projeto será criado.');
  const branch=project.production_branch;
  if (typeof branch!=='string' || !/^[A-Za-z0-9._/-]{1,100}$/.test(branch) || branch.startsWith('-'))
    throw new Error('A branch de produção precisa ser conferida antes da publicação.');
  return {project:project.name,branch,hostname:project.subdomain};
}

export async function existingProject(accountId,token,fetcher=fetch) {
  if (!/^[a-f0-9]{32}$/i.test(accountId || '') || !token)
    throw new Error('Configure CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN nos segredos do GitHub.');
  const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/radardatropa`,{
    headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Não foi possível acessar o projeto Cloudflare (HTTP ${response.status}). Confira a conta e a permissão Cloudflare Pages: Edit.`);
  return projectConfiguration(await response.json());
}

if (process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  try {
    const configuration=await existingProject(process.env.CLOUDFLARE_ACCOUNT_ID,process.env.CLOUDFLARE_API_TOKEN);
    if (!process.env.GITHUB_ENV) throw new Error('Este comando deve ser executado no fluxo de publicação do GitHub.');
    await appendFile(process.env.GITHUB_ENV,`CLOUDFLARE_PAGES_PROJECT=${configuration.project}\nCLOUDFLARE_PRODUCTION_BRANCH=${configuration.branch}\n`);
    console.log(`Projeto existente confirmado: ${configuration.hostname}.`);
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
