import { getDb } from "../lib/db.js";
import type { CategoryDTO } from "../types/index.js";

export async function getActiveCategories(): Promise<CategoryDTO[]> {
  const db = getDb();
  return db.serviceCategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      icon: true,
      image: true,
    },
  });
}

export async function getCategoryBySlug(slug: string): Promise<CategoryDTO | null> {
  const db = getDb();
  return db.serviceCategory.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      icon: true,
      image: true,
    },
  });
}
