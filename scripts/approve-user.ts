/**
 * Aprueba el login de un usuario (pone `approved_login = 1`).
 *
 *   npm run approve -- alguien@gmail.com
 *
 * El primer login con `SEED_ADMIN_EMAIL` se aprueba solo; el resto arranca
 * pendiente y se habilita con este comando (o, más adelante, desde el
 * panel admin en Settings).
 */
import 'dotenv/config';
import { approveUserByEmail } from '../api/_lib/authRepo.js';
import { getDb } from '../api/_lib/db.js';

async function main() {
  const email = process.argv[2]?.trim();
  if (!email) {
    console.error('Uso: npm run approve -- <email>');
    process.exitCode = 1;
    return;
  }
  // getDb() valida que TURSO_DATABASE_URL esté configurada.
  getDb();
  const ok = await approveUserByEmail(email);
  if (ok) {
    console.log(`✔ ${email} aprobado.`);
  } else {
    console.error(`No hay ningún usuario con el email "${email}" (¿ya inició sesión al menos una vez?).`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
