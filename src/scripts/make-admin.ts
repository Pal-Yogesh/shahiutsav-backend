// Grants the admin role to an existing account.
// Usage: npm run make-admin -- someone@example.com   (they must have signed in once)
import { getDb } from "../lib/db.js";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run make-admin -- <email>");
  process.exit(1);
}

const db = getDb();
const user = await db.user.findUnique({ where: { email }, select: { id: true, role: true } });
if (!user) {
  console.error(`No account for ${email}. Sign in on the website once first, then run this again.`);
  process.exit(1);
}
if (user.role === "admin") {
  console.log(`${email} is already an admin.`);
} else {
  await db.user.update({ where: { id: user.id }, data: { role: "admin" } });
  console.log(`${email} is now an admin. Reload the website and open /admin.`);
}
process.exit(0);
