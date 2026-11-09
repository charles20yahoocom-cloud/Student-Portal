// Rotate the well-known demo passwords. Run once after deploying the P0 fixes:
//   node seeds/rotate-demo-passwords.js
// Existing real accounts (non-demo emails) are never touched.
require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('../src/config/database');

const ACCOUNTS = [
  { email: 'admin@pcc.edu.ph', password: process.env.DEMO_ADMIN_PASSWORD || 'PccAdmin#2026' },
  { email: 'dean.it@pcc.edu.ph', password: process.env.DEMO_DEAN_PASSWORD || 'PccDean#2026' },
  { email: 'dean.crim@pcc.edu.ph', password: process.env.DEMO_CRIM_PASSWORD || 'PccCrim#2026' },
  { email: 'teacher.john@pcc.edu.ph', password: process.env.DEMO_TEACHER_PASSWORD || 'PccTeacher#2026' },
  { email: 'juan.delacruz@pcc.edu.ph', password: process.env.DEMO_STUDENT_PASSWORD || 'PccStudent#2026' }
];

async function rotate() {
  if (process.env.NODE_ENV === 'production' && process.env.ROTATE_DEMO !== '1') {
    console.error('Refusing to rotate demo passwords in production. Set ROTATE_DEMO=1 to confirm.');
    process.exit(1);
  }

  const find = db.prepare('SELECT id, email, role FROM users WHERE lower(email) = lower(?)');
  const update = db.prepare(`
    UPDATE users
    SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL, updated_at = datetime('now')
    WHERE id = ?
  `);

  console.log('Rotating demo passwords...\n');
  for (const account of ACCOUNTS) {
    const user = find.get(account.email);
    if (!user) {
      console.log(`- skipped ${account.email} (no such account)`);
      continue;
    }
    const hash = await bcrypt.hash(account.password, 10);
    update.run(hash, user.id);
    console.log(`- ${user.role.padEnd(7)} ${account.email}  ->  ${account.password}`);
  }

  // The demo-data seeder creates 20 BSIT students that share the class demo
  // password. Rotate them too so no well-known password survives a deploy.
  const classPassword = process.env.DEMO_STUDENT_PASSWORD || 'PccStudent#2026';
  const classHash = await bcrypt.hash(classPassword, 10);
  const demoStudents = db.prepare(`
    SELECT u.id, u.email
    FROM users u
    JOIN students s ON s.user_id = u.id
    WHERE s.student_no LIKE '2024-100%'
    ORDER BY s.student_no
  `).all();
  for (const student of demoStudents) {
    update.run(classHash, student.id);
  }
  if (demoStudents.length) {
    console.log(`- student ${demoStudents.length} demo section accounts -> ${classPassword}`);
  }

  console.log('\nDone. Share these only with the people who need them.');
}

rotate().catch((err) => {
  console.error('Rotation failed:', err);
  process.exit(1);
});
