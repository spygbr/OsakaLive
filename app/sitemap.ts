import { MetadataRoute } from "next";
import {
  getAllArtistSlugs,
  getAllVenueSlugs,
  getAllEventSlugs,
} from "@/lib/supabase/queries";

const BASE_URL = "https://osaka-live.net";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [artistSlugs, venueSlugs, eventSlugs] = await Promise.all([
    getAllArtistSlugs(),
    getAllVenueSlugs(),
    getAllEventSlugs(),
  ]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: "hourly", priority: 1 },
    { url: `${BASE_URL}/calendar`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE_URL}/venues`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE_URL}/artists`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE_URL}/tickets`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE_URL}/guide`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE_URL}/privacy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE_URL}/terms`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
  ];

  const venueRoutes: MetadataRoute.Sitemap = venueSlugs.map((slug) => ({
    url: `${BASE_URL}/venues/${slug}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const artistRoutes: MetadataRoute.Sitemap = artistSlugs.map((slug) => ({
    url: `${BASE_URL}/artists/${slug}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  const eventRoutes: MetadataRoute.Sitemap = eventSlugs.map((slug) => ({
    url: `${BASE_URL}/event/${slug}`,
    lastModified: new Date(),
    changeFrequency: "daily",
    priority: 0.8,
  }));

  return [...staticRoutes, ...venueRoutes, ...artistRoutes, ...eventRoutes];
}
