import { getDb } from "../lib/db.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { VendorCardDTO, VendorDetailDTO } from "../types/index.js";
import type { SearchParamsInput } from "../validators/search.validator.js";

function buildSortOrder(sort: string): Prisma.VendorProfileOrderByWithRelationInput {
  switch (sort) {
    case "price_asc":
      return { services: { _count: "asc" } };
    case "price_desc":
      return { services: { _count: "desc" } };
    case "rating":
      return { rating: "desc" };
    case "reviews":
      return { totalReviews: "desc" };
    default:
      return { totalBookings: "desc" };
  }
}

export async function searchVendors(params: SearchParamsInput) {
  const db = getDb();
  const { q, city, category, page, limit, sort } = params;
  const skip = (page - 1) * limit;

  // Only approved, active vendors are public
  const where: Prisma.VendorProfileWhereInput = { status: "APPROVED", isActive: true };

  if (q) {
    where.OR = [
      { businessName: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { services: { some: { title: { contains: q, mode: "insensitive" } } } },
    ];
  }

  if (city) {
    where.city = { slug: city };
  }

  if (category) {
    where.services = {
      some: { category: { slug: category }, isActive: true },
    };
  }

  const [vendors, total] = await Promise.all([
    db.vendorProfile.findMany({
      where,
      skip,
      take: limit,
      orderBy: buildSortOrder(sort),
      select: {
        id: true,
        businessName: true,
        slug: true,
        description: true,
        profileImage: true,
        coverImage: true,
        rating: true,
        totalReviews: true,
        isVerified: true,
        city: { select: { id: true, name: true, slug: true, state: true } },
        services: {
          where: { isActive: true },
          select: {
            price: true,
            category: { select: { name: true } },
          },
          orderBy: { price: "asc" },
        },
      },
    }),
    db.vendorProfile.count({ where }),
  ]);

  const data: VendorCardDTO[] = vendors.map((v) => ({
    id: v.id,
    businessName: v.businessName,
    slug: v.slug,
    description: v.description,
    profileImage: v.profileImage,
    coverImage: v.coverImage,
    rating: v.rating,
    totalReviews: v.totalReviews,
    isVerified: v.isVerified,
    city: v.city,
    categories: [...new Set(v.services.map((s) => s.category.name))],
    startingPrice: v.services.length > 0 ? v.services[0].price : null,
  }));

  return { data, total };
}

export async function getVendorBySlug(slug: string): Promise<VendorDetailDTO | null> {
  const db = getDb();
  const vendor = await db.vendorProfile.findUnique({
    where: { slug, status: "APPROVED", isActive: true },
    select: {
      id: true,
      businessName: true,
      slug: true,
      description: true,
      phone: true,
      whatsapp: true,
      address: true,
      pincode: true,
      profileImage: true,
      coverImage: true,
      rating: true,
      totalReviews: true,
      totalBookings: true,
      isVerified: true,
      city: { select: { id: true, name: true, slug: true, state: true } },
      services: {
        where: { isActive: true },
        select: {
          id: true,
          title: true,
          description: true,
          priceType: true,
          price: true,
          priceUnit: true,
          images: true,
          category: {
            select: { id: true, name: true, slug: true, description: true, icon: true, image: true },
          },
        },
      },
      reviews: {
        take: 10,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          customer: { select: { name: true, image: true } },
        },
      },
    },
  });

  if (!vendor) return null;

  return {
    ...vendor,
    reviews: vendor.reviews.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function getFeaturedVendors(limit = 8): Promise<VendorCardDTO[]> {
  const db = getDb();
  const vendors = await db.vendorProfile.findMany({
    where: { status: "APPROVED", isActive: true },
    take: limit,
    orderBy: [{ rating: "desc" }, { totalBookings: "desc" }],
    select: {
      id: true,
      businessName: true,
      slug: true,
      description: true,
      profileImage: true,
      coverImage: true,
      rating: true,
      totalReviews: true,
      isVerified: true,
      city: { select: { id: true, name: true, slug: true, state: true } },
      services: {
        where: { isActive: true },
        select: {
          price: true,
          category: { select: { name: true } },
        },
        orderBy: { price: "asc" },
      },
    },
  });

  return vendors.map((v) => ({
    id: v.id,
    businessName: v.businessName,
    slug: v.slug,
    description: v.description,
    profileImage: v.profileImage,
    coverImage: v.coverImage,
    rating: v.rating,
    totalReviews: v.totalReviews,
    isVerified: v.isVerified,
    city: v.city,
    categories: [...new Set(v.services.map((s) => s.category.name))],
    startingPrice: v.services.length > 0 ? v.services[0].price : null,
  }));
}
