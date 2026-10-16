-- M6 security review: no SVG uploads in the public landing-assets bucket. An SVG can carry scripts,
-- which would run on the Supabase storage domain when its public link is opened directly. Logos
-- work as PNG / JPEG / WebP. (No SVG files had been uploaded.)
update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
where id = 'landing-assets';
