import { getDb } from "./lib/db.js";

const img = (id: string) => `https://images.unsplash.com/photo-${id}`;

const categories = [
  { name: "DJ & Entertainment", slug: "dj-entertainment", icon: "Disc3", image: img("1574391884720-bbc3740c59d1"), description: "Professional DJs, live bands, singers and dhol players", sortOrder: 1 },
  { name: "Photography & Video", slug: "photography", icon: "Camera", image: img("1452587925148-ce544e77e70d"), description: "Wedding, pre-wedding, cinematic and drone coverage", sortOrder: 2 },
  { name: "Decoration", slug: "decoration", icon: "Flower2", image: img("1523438885200-e635ba2c371e"), description: "Mandaps, floral design, themes and entrance gates", sortOrder: 3 },
  { name: "Catering", slug: "catering", icon: "UtensilsCrossed", image: img("1555244162-803834f70033"), description: "Multi-cuisine caterers, live counters and food stalls", sortOrder: 4 },
  { name: "Sound & Audio", slug: "sound-audio", icon: "Speaker", image: img("1524368535928-5b5e00ddc76b"), description: "Line arrays, subwoofers, mixers and wireless mics", sortOrder: 5 },
  { name: "Lighting & LED", slug: "lighting-led", icon: "Lightbulb", image: img("1459749411175-04bf5292ceea"), description: "Moving heads, LED walls, lasers and stage lighting", sortOrder: 6 },
  { name: "Stage, Tents & Furniture", slug: "stage-furniture", icon: "Tent", image: img("1464366400600-7168b8af9bc3"), description: "Stages, dance floors, tents, seating and tables", sortOrder: 7 },
  // { name: "Artists & Performers", slug: "artists-performers", icon: "Mic2", image: img("1598387993441-a364f854c3e1"), description: "Anchors, singers, dancers and celebrity acts", sortOrder: 8 },
  // { name: "Hospitality & Staff", slug: "event-staff", icon: "Users", image: img("1514933651103-005eec06c04b"), description: "Bartenders, waiters, valets and event crew", sortOrder: 9 },
];

// Hidden from the site. equipment-rental was replaced by the sound / lighting / stage
// categories; the other two are not offered for now.
const retiredSlugs = ["equipment-rental", "artists-performers", "event-staff"];

const cities = [
  { name: "Delhi NCR", slug: "delhi-ncr", state: "Delhi", sortOrder: 1 },
  { name: "Mumbai", slug: "mumbai", state: "Maharashtra", sortOrder: 2 },
  { name: "Bengaluru", slug: "bengaluru", state: "Karnataka", sortOrder: 3 },
  { name: "Pune", slug: "pune", state: "Maharashtra", sortOrder: 4 },
  { name: "Jaipur", slug: "jaipur", state: "Rajasthan", sortOrder: 5 },
  { name: "Bhopal", slug: "bhopal", state: "Madhya Pradesh", sortOrder: 6 },
  { name: "Hyderabad", slug: "hyderabad", state: "Telangana", sortOrder: 7 },
  { name: "Ahmedabad", slug: "ahmedabad", state: "Gujarat", sortOrder: 8 },
  { name: "Lucknow", slug: "lucknow", state: "Uttar Pradesh", sortOrder: 9 },
  { name: "Kolkata", slug: "kolkata", state: "West Bengal", sortOrder: 10 },
];

async function seed() {
  const db = getDb();

  console.log("Seeding categories...");
  for (const cat of categories) {
    await db.serviceCategory.upsert({
      where: { slug: cat.slug },
      update: { ...cat, isActive: true },
      create: cat,
    });
  }
  await db.serviceCategory.updateMany({
    where: { slug: { in: retiredSlugs } },
    data: { isActive: false },
  });

  console.log("Seeding cities...");
  for (const city of cities) {
    await db.city.upsert({
      where: { slug: city.slug },
      update: city,
      create: city,
    });
  }

  console.log("Seed complete.");
}

seed().catch(console.error);
