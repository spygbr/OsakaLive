import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/search?"],
    },
    sitemap: "https://osaka-live.net/sitemap.xml",
  };
}
