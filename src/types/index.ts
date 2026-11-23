// ─── API Response ────────────────────────────────────────────────────

export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  // Per-field validation messages, keyed by path such as "services.0.price"
  fieldErrors?: Record<string, string>;
  meta?: PaginationMeta;
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

// ─── DTOs (shared between backend and frontend) ──────────────────────

export type CategoryDTO = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  image: string | null;
};

export type CityDTO = {
  id: string;
  name: string;
  slug: string;
  state: string;
};

export type VendorCardDTO = {
  id: string;
  businessName: string;
  slug: string;
  description: string | null;
  profileImage: string | null;
  coverImage: string | null;
  rating: number;
  totalReviews: number;
  isVerified: boolean;
  city: CityDTO;
  categories: string[];
  startingPrice: number | null;
};

export type VendorDetailDTO = {
  id: string;
  businessName: string;
  slug: string;
  description: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  pincode: string | null;
  profileImage: string | null;
  coverImage: string | null;
  rating: number;
  totalReviews: number;
  totalBookings: number;
  isVerified: boolean;
  city: CityDTO;
  services: ServiceDTO[];
  reviews: ReviewDTO[];
};

export type ServiceDTO = {
  id: string;
  title: string;
  description: string | null;
  priceType: string;
  price: number;
  priceUnit: string | null;
  images: string[];
  category: CategoryDTO;
};

export type ReviewDTO = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  customer: {
    name: string;
    image: string | null;
  };
};

export type BookingDTO = {
  id: string;
  eventDate: string;
  eventType: string;
  guestCount: number | null;
  venue: string | null;
  status: string;
  totalAmount: number;
  createdAt: string;
  city: CityDTO;
  items: BookingItemDTO[];
};

export type BookingItemDTO = {
  id: string;
  price: number;
  status: string;
  notes: string | null;
  vendor: {
    businessName: string;
    slug: string;
    profileImage: string | null;
  };
  service: {
    title: string;
    category: string;
  };
};
