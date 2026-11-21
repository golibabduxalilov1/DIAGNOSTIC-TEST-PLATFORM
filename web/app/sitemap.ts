import type {MetadataRoute} from 'next';
export default function sitemap():MetadataRoute.Sitemap{
 return [{url:process.env.SITE_URL||'https://intizomkalit.uz',changeFrequency:'monthly',priority:1}];
}
