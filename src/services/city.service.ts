import { getDb } from "../lib/db.js";
import type { CityDTO } from "../types/index.js";

export async function getActiveCities(): Promise<CityDTO[]> {
  const db = getDb();
  return db.city.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      state: true,
    },
  });
}

export async function getCityBySlug(slug: string): Promise<CityDTO | null> {
  const db = getDb();
  return db.city.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      state: true,
    },
  });
}
