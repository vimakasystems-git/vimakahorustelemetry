import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const secret = () => randomBytes(32).toString('hex');
const value = `HORUS_API_TOKEN=${secret()}\nHORUS_ENABLE_DEMO=true\nGRAFANA_ADMIN_USER=admin\nGRAFANA_ADMIN_PASSWORD=${secret()}\nPOSTGRES_PASSWORD=${secret()}\n`;
try {
  await writeFile(new URL('../.env', import.meta.url), value, { flag: 'wx', mode: 0o600 });
  console.log('Arquivo .env criado para desenvolvimento local. Credenciais nao foram impressas.');
} catch (error) {
  if (error.code === 'EEXIST') console.error('O arquivo .env ja existe e foi preservado.');
  else console.error('Nao foi possivel criar .env.');
  process.exitCode = 1;
}
