-- One-time seed for the current public business directory.
-- Paste this into the Supabase SQL Editor after running supabase/schema.sql.
-- This script both updates existing rows and inserts missing ones.

with seed (
  business_category,
  business_name,
  description,
  contact_name,
  phone,
  business_email,
  address,
  image_url,
  website_url,
  hours,
  notes,
  sort_order
) as (
  values
    ('Community & Government', 'Bly Ranger District (Forest Service)', 'District office for recreation info, permits, and forest resources in the Bly area.', null, '(541) 353-2427', null, 'Highway 140, P.O. Box 25, Bly, OR 97622', 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Forest_Service_logo.png/600px-Forest_Service_logo.png', 'https://www.fs.usda.gov/r06/fremont-winema/recreation/bly-ranger-district', 'Mon-Fri, 7:45 am-4:30 pm (closed holidays)', 'Website label on old page: fs.usda.gov', 10),
    ('Community & Government', 'Bly Community Action Team', 'Local community group supporting events and projects in Bly.', null, '(541) 891-4661', null, 'P.O. Box 483, Bly, OR 97622', '/assets/blycatlogo.png', 'https://www.facebook.com/blyoregon/', null, 'Website/social: Facebook', 20),
    ('Community & Government', 'Bly Fire Department', 'Emergency services for the Bly area.', 'Bruce Nichols', '(541) 205-9260', 'bruce.nichols@blyrfpd.com', null, '/assets/BLYRFPDlogo.png', 'https://www.facebook.com/groups/501603116688599/', null, 'Emergency: Call 9-1-1. Website/social: Facebook.', 30),
    ('Community & Government', 'United States Postal Service (Bly)', 'Postal services for Bly.', null, null, null, '61133 OR-140, Bly, OR 97622', '/assets/United-States-Postal-Service-Logo.png', 'https://tools.usps.com/locations/details/1355296', null, 'Website label on old page: usps.com', 40),
    ('Community & Government', 'Bly Branch Library', 'Public library branch serving Bly.', null, '(541) 353-2299', null, '61100 Metler St, Bly, OR 97622', 'https://klamathlibrary.org/sites/default/files/images/Bly2015-1.jpg', 'https://klamathlibrary.org/bly-branch', null, 'Website label on old page: klamathlibrary.org', 50),

    ('Food & Drink', 'The Breadwagon', 'Local favorite for food in the Bly area. Also offers Gearhart Sugar Shack and The Breadwagon mobile concessions and catering.', null, '(541) 591-0035', null, '61435 OR-140, Bly, OR 97622', '/assets/BreadWagonImage.jpg', 'https://www.facebook.com/thebreadwagon/', null, 'Website/social: Facebook', 10),
    ('Food & Drink', 'Sycan Store', 'Groceries, liquor, and more.', null, '(541) 353-2271', null, null, '/assets/SycanStoreImage.jpg', 'https://www.facebook.com/profile.php?id=61560008241304', null, 'Website/social: Facebook', 20),
    ('Food & Drink', 'The Highway Cafe', 'Local cafe serving the Bly area.', null, '(541) 407-0312', 'highwaycafellc23@gmail.com', '61036 Hwy 140 E, Bly, OR 97622', '/assets/HighwayCafeImage.jpg', 'https://www.facebook.com/p/The-Highway-Cafe-61564613140888/', null, 'Website/social: Facebook', 30),
    ('Food & Drink', 'Fastbreak Convenience Store - Bly Market', '', null, '(541) 353-2551', null, '61430 OR-140, Bly, OR 97622', '/assets/FastBreak.jpg', null, null, null, 40),

    ('Shopping', 'The Bly Outdoor Store', 'Outdoor store in the Bly area (Running W Enterprises LLC). Country crafts also listed at this location.', null, '(541) 326-6047', null, '61556 Hwy 140E, Bly, OR 97622', '/assets/RunningWEnterpriseslogo.png', null, 'Tue-Sat, 9-5 (closed Sun & Mon)', null, 10),
    ('Shopping', 'Outlaw Rocks', 'Rocks, stones, and related items in the Bly area.', null, null, 'outlawrocksllc@gmail.com', '61282 Highway 140, Bly, OR 97622', '/assets/OutlawRocks.jpg', 'https://outlawrocksllc.com', null, 'Facebook: https://www.facebook.com/outlawrocksllc/', 20),
    ('Shopping', 'Rustic Rain', 'Handcrafted goods and rustic decor by Chrissy Holgate.', 'Chrissy Holgate', '(541) 891-2568', 'rusticrain@hotmail.com', null, '/assets/RusticRainImage.jpg', 'https://www.facebook.com/rusticrain78/', null, 'Website/social: Facebook', 30),
    ('Shopping', 'Main Street Mercantile', 'Gifts, home decor, and more.', null, '(541) 591-0035', null, '19311 Main Ave, Bly, OR 97622', '/assets/MainStreetMercantile.jpg', 'https://www.facebook.com/mainstreetmercantilebly/', null, 'Website/social: Facebook', 40),

    ('Services & Trades', 'Country Crafts', 'Need sewing done: patching, repair, resizing, or make what you need.', 'Tess Wilson', '(541) 944-1503', null, '61556 Hwy 140E #442, Bly, OR 97622', null, null, null, 'Store phone: (541) 326-6047', 10),
    ('Services & Trades', 'Delta-S Designs', 'Custom bags & covers, clipper blades sharpened, horse blankets cleaned & repaired, and more.', null, '(541) 810-3070', 'Ann@delta-s.net', null, null, null, null, 'Website on old page: delta-s.net (currently not working)', 20),
    ('Services & Trades', 'Grant Plumbing', 'Plumbing services.', null, '(541) 281-9819', null, null, null, null, null, null, 30),
    ('Services & Trades', 'Holgate Plumbing', 'Veteran owned & operated plumbing services.', null, '(541) 891-3557', null, null, '/assets/HolgatePlumbing.jpg', 'https://www.holgateplumbing.com/', null, 'Facebook: https://www.facebook.com/p/Holgate-Plumbing-100093822325623/', 40),
    ('Services & Trades', 'John Richmond Contracting', 'Custom cat work.', null, '(541) 891-0745', null, 'Bly, OR 97622', null, null, null, 'Original label: Service Area: Bly, OR 97622', 50),
    ('Services & Trades', 'Melsness Logging', 'Logging services.', null, '(541) 353-2510', null, null, null, null, null, 'Alternate phone: (541) 891-4954', 60),
    ('Services & Trades', 'Millen Construction', 'General contracting and construction.', null, null, null, null, 'https://i0.wp.com/millenconstruction.com/wp-content/uploads/2020/02/Blue-logo-transparent-bg.png?=1200&ssl=1', 'http://millenconstruction.com/', null, 'Facebook: https://www.facebook.com/millenconstruction/', 70),
    ('Services & Trades', 'Paul Melsness Refinishing', 'Refinishing services.', null, '(541) 891-0636', null, '22605 Hwy 70, Bonanza, OR 97623', null, null, null, null, 80),
    ('Services & Trades', 'Duarte Sales', 'Licensed & bonded auctioneer. Sales managed and promoted.', 'Eric Duarte & Nikki Duarte', '(541) 533-2105', null, null, null, 'http://www.duartesales.com', null, 'Fax: (541) 533-3127. Cell: (541) 891-7863. Facebook: https://www.facebook.com/profile.php?id=100057065245352', 90),
    ('Services & Trades', 'Running W Enterprises', 'Cattle & hay sales, security, Oregon notary, and certified firearms instruction.', null, '(541) 944-3835', 'runningwenterprises@gmail.com', 'P.O. Box 442, Bly, OR 97622', '/assets/RunningWEnterpriseslogo.png', null, null, 'Fax: (541) 353-2629', 100),

    ('Health & Wellness', 'Bly Beauties', 'Community group (Ladies over 50).', null, '(530) 249-4173', null, null, null, null, null, null, 10),
    ('Health & Wellness', 'Klamath Hospice and Palliative Care', 'Your care is our mission.', null, '(541) 882-2902', null, null, null, 'https://www.klamathhospice.org', null, 'Website label on old page: klamathhospice.org', 20),
    ('Health & Wellness', 'The Bonanza Clinic', 'Primary care clinic.', 'Michael A. Sheets, FNP', '(541) 545-1820', null, '31863 Hwy 70, Bonanza, OR 97623', null, null, 'Mon-Fri, 2-6 pm', 'Original label: Provider: Michael A. Sheets, FNP', 30),

    ('Lodging', 'Aspen Ridge Resort', 'A family-owned guest ranch and resort on a century-old working cattle ranch, offering rustic lodging in handcrafted log cabins and lodge rooms, hearty dining, and ranch-style recreation (horseback riding, fishing, hiking, and more).', null, '(541) 884-8685', null, 'Mile Marker 18 Fishhole Creek Rd, Bly, OR 97622', '/assets/AspenRidgeresortImage.gif', 'https://www.aspenrr.com/', null, 'Website label on old page: aspenrr.com', 10),
    ('Lodging', 'The Barn at Marvin Garden', 'Peaceful off-the-beaten-path stay with original post-and-beam craftsmanship, open rafters, and a chef-ready kitchen. Steps to the OC&E Trail, a private patio with Gearhart Mountain views, and easy access to the Bread Wagon, Aspen Ridge, and the Cowboy Dinner Tree.', 'Sheila Mckelvie', '(541) 771-8382', null, null, '/assets/TheBarnatMarvinGarden.avif', 'https://www.airbnb.com/rooms/1224719521013161560?guests=1&adults=1&s=67&unique_share_id=24677418-1c9e-408d-8dbd-7241ca74623c', null, 'Space: 2 bedrooms, 2 queen beds, 1 bathroom. Amenities: On-demand hot water, infrared sauna, Starlink internet. Guest access: Whole property.', 20),
    ('Lodging', 'Cornell Rental', 'Private rental with a full kitchen.', 'Suzanne', null, null, '19019 Waldeck Street, Bly, OR 97622', '/assets/CornellRental.jpg', null, null, 'Space: 1 double bed, 1 pull-out couch. Rate: $80 per night.', 30),
    ('Lodging', 'Lone Pine Trailer Park', 'Overnighters welcome.', 'Donna Kness', '(541) 591-0035', null, null, null, null, null, null, 40),

    ('Education', 'Gearhart Elementary School', 'Public elementary school serving the Bly area.', null, '(541) 353-2417', 'nixonm@kcsd.k12.or.us', '61100 Metler St, Bly, OR 97622', 'https://www.kcsd.k12.or.us/custom/schools/gearhart/general/asset_logo.svg', 'https://www.kcsd.k12.or.us/schools/gearhart/', null, 'Website label on old page: kcsd.k12.or.us. Facebook: https://www.facebook.com/profile.php?id=61564219626370', 10),
    ('Education', 'Bly Preschool', 'For 3, 4 & 5 year old students. Monday & Thursday 9:30-11:30.', 'Leda Hunter / Pat Phillips', null, null, null, null, null, 'Monday & Thursday 9:30-11:30', 'Contacts: Leda Hunter - (541) 891-4661. Pat Phillips - (541) 891-0746.', 20),

    ('Faith & Churches', 'Abiding Place Ministries', 'Sunday service 10:30 am & 6:00 pm. Wednesday at 7:00 pm.', 'Daniel / Brad', null, null, '71410 Highway 140 E, Bly, OR 97622', null, null, 'Sunday 10:30 am and 6:00 pm. Wednesday 7:00 pm.', 'Daniel: (619) 890-1921. Brad: (760) 239-1551.', 10),
    ('Faith & Churches', 'Beatty Valley Church', 'Sunday School 10 am, Church 11 am. Wednesday night Bible Study 6 pm.', 'Cindy Bowles', '(541) 591-9825', null, '42726 Walnut St., Beatty, OR 97621', null, null, 'Sunday School 10 am, Church 11 am, Wednesday Bible Study 6 pm', 'Pastor: Cindy Bowles', 20),
    ('Faith & Churches', 'Standing Stone Church', 'Sunday School 9:45 am, Sunday Service 11:00 am, Thursday Bible Study 5:00 pm.', 'David Prantner', '(541) 353-2622', null, null, '/assets/StandingStoneChurchimage.jpg', 'https://www.facebook.com/StandingStoneCMA/', 'Sunday School 9:45 am, Sunday Service 11:00 am, Thursday Bible Study 5:00 pm', 'Website/social: Facebook', 30),
    ('Faith & Churches', 'St. James Catholic Church', 'Mass 11:30 a.m. Holy Days 5:00 p.m. Vigil.', null, null, null, 'Bly, OR', null, null, 'Mass 11:30 a.m. Holy Days 5:00 p.m. Vigil.', 'Original label: City: Bly, OR', 40),

    ('Utilities', 'Bly Water and Sanitation District', 'Local water and sanitation services.', null, '(541) 353-2562', null, '61138 Hwy 140 E, Bly, OR 97622', '/assets/BlyWaterimage.png', 'https://www.blywater.com/', null, 'Emergency: (541) 891-3902. Facebook: https://www.facebook.com/p/Bly-Water-and-Sanitary-District-100079576039064/', 10),

    ('Recreation & Community Space', 'Ruth Obenchain Recreation Center', 'Membership-run community gym with scheduled events. The building is not staffed and the doors stay locked; access is arranged through the website (typically at least a day in advance) for monthly memberships and open gym nights. Rentals are also handled online-call if you have questions.', null, '(541) 904-0428', null, '19140 Edler Street, Bly, OR 97622', '/assets/rorchomeimage.jpg', 'https://ruthobenchainrc.com', null, 'Website label on old page: ruthobenchainrc.com', 10)
)
update public.businesses as existing
set
  description = seed.description,
  contact_name = seed.contact_name,
  phone = seed.phone,
  business_email = seed.business_email,
  address = seed.address,
  image_url = seed.image_url,
  website_url = seed.website_url,
  hours = seed.hours,
  notes = seed.notes,
  sort_order = seed.sort_order,
  updated_at = now()
from seed
where existing.business_name = seed.business_name
  and existing.business_category = seed.business_category;

with seed (
  business_category,
  business_name,
  description,
  contact_name,
  phone,
  business_email,
  address,
  image_url,
  website_url,
  hours,
  notes,
  sort_order
) as (
  values
    ('Community & Government', 'Bly Ranger District (Forest Service)', 'District office for recreation info, permits, and forest resources in the Bly area.', null, '(541) 353-2427', null, 'Highway 140, P.O. Box 25, Bly, OR 97622', 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Forest_Service_logo.png/600px-Forest_Service_logo.png', 'https://www.fs.usda.gov/r06/fremont-winema/recreation/bly-ranger-district', 'Mon-Fri, 7:45 am-4:30 pm (closed holidays)', 'Website label on old page: fs.usda.gov', 10),
    ('Community & Government', 'Bly Community Action Team', 'Local community group supporting events and projects in Bly.', null, '(541) 891-4661', null, 'P.O. Box 483, Bly, OR 97622', '/assets/blycatlogo.png', 'https://www.facebook.com/blyoregon/', null, 'Website/social: Facebook', 20),
    ('Community & Government', 'Bly Fire Department', 'Emergency services for the Bly area.', 'Bruce Nichols', '(541) 205-9260', 'bruce.nichols@blyrfpd.com', null, '/assets/BLYRFPDlogo.png', 'https://www.facebook.com/groups/501603116688599/', null, 'Emergency: Call 9-1-1. Website/social: Facebook.', 30),
    ('Community & Government', 'United States Postal Service (Bly)', 'Postal services for Bly.', null, null, null, '61133 OR-140, Bly, OR 97622', '/assets/United-States-Postal-Service-Logo.png', 'https://tools.usps.com/locations/details/1355296', null, 'Website label on old page: usps.com', 40),
    ('Community & Government', 'Bly Branch Library', 'Public library branch serving Bly.', null, '(541) 353-2299', null, '61100 Metler St, Bly, OR 97622', 'https://klamathlibrary.org/sites/default/files/images/Bly2015-1.jpg', 'https://klamathlibrary.org/bly-branch', null, 'Website label on old page: klamathlibrary.org', 50),

    ('Food & Drink', 'The Breadwagon', 'Local favorite for food in the Bly area. Also offers Gearhart Sugar Shack and The Breadwagon mobile concessions and catering.', null, '(541) 591-0035', null, '61435 OR-140, Bly, OR 97622', '/assets/BreadWagonImage.jpg', 'https://www.facebook.com/thebreadwagon/', null, 'Website/social: Facebook', 10),
    ('Food & Drink', 'Sycan Store', 'Groceries, liquor, and more.', null, '(541) 353-2271', null, null, '/assets/SycanStoreImage.jpg', 'https://www.facebook.com/profile.php?id=61560008241304', null, 'Website/social: Facebook', 20),
    ('Food & Drink', 'The Highway Cafe', 'Local cafe serving the Bly area.', null, '(541) 407-0312', 'highwaycafellc23@gmail.com', '61036 Hwy 140 E, Bly, OR 97622', '/assets/HighwayCafeImage.jpg', 'https://www.facebook.com/p/The-Highway-Cafe-61564613140888/', null, 'Website/social: Facebook', 30),
    ('Food & Drink', 'Fastbreak Convenience Store - Bly Market', '', null, '(541) 353-2551', null, '61430 OR-140, Bly, OR 97622', '/assets/FastBreak.jpg', null, null, null, 40),

    ('Shopping', 'The Bly Outdoor Store', 'Outdoor store in the Bly area (Running W Enterprises LLC). Country crafts also listed at this location.', null, '(541) 326-6047', null, '61556 Hwy 140E, Bly, OR 97622', '/assets/RunningWEnterpriseslogo.png', null, 'Tue-Sat, 9-5 (closed Sun & Mon)', null, 10),
    ('Shopping', 'Outlaw Rocks', 'Rocks, stones, and related items in the Bly area.', null, null, 'outlawrocksllc@gmail.com', '61282 Highway 140, Bly, OR 97622', '/assets/OutlawRocks.jpg', 'https://outlawrocksllc.com', null, 'Facebook: https://www.facebook.com/outlawrocksllc/', 20),
    ('Shopping', 'Rustic Rain', 'Handcrafted goods and rustic decor by Chrissy Holgate.', 'Chrissy Holgate', '(541) 891-2568', 'rusticrain@hotmail.com', null, '/assets/RusticRainImage.jpg', 'https://www.facebook.com/rusticrain78/', null, 'Website/social: Facebook', 30),
    ('Shopping', 'Main Street Mercantile', 'Gifts, home decor, and more.', null, '(541) 591-0035', null, '19311 Main Ave, Bly, OR 97622', '/assets/MainStreetMercantile.jpg', 'https://www.facebook.com/mainstreetmercantilebly/', null, 'Website/social: Facebook', 40),

    ('Services & Trades', 'Country Crafts', 'Need sewing done: patching, repair, resizing, or make what you need.', 'Tess Wilson', '(541) 944-1503', null, '61556 Hwy 140E #442, Bly, OR 97622', null, null, null, 'Store phone: (541) 326-6047', 10),
    ('Services & Trades', 'Delta-S Designs', 'Custom bags & covers, clipper blades sharpened, horse blankets cleaned & repaired, and more.', null, '(541) 810-3070', 'Ann@delta-s.net', null, null, null, null, 'Website on old page: delta-s.net (currently not working)', 20),
    ('Services & Trades', 'Grant Plumbing', 'Plumbing services.', null, '(541) 281-9819', null, null, null, null, null, null, 30),
    ('Services & Trades', 'Holgate Plumbing', 'Veteran owned & operated plumbing services.', null, '(541) 891-3557', null, null, '/assets/HolgatePlumbing.jpg', 'https://www.holgateplumbing.com/', null, 'Facebook: https://www.facebook.com/p/Holgate-Plumbing-100093822325623/', 40),
    ('Services & Trades', 'John Richmond Contracting', 'Custom cat work.', null, '(541) 891-0745', null, 'Bly, OR 97622', null, null, null, 'Original label: Service Area: Bly, OR 97622', 50),
    ('Services & Trades', 'Melsness Logging', 'Logging services.', null, '(541) 353-2510', null, null, null, null, null, 'Alternate phone: (541) 891-4954', 60),
    ('Services & Trades', 'Millen Construction', 'General contracting and construction.', null, null, null, null, 'https://i0.wp.com/millenconstruction.com/wp-content/uploads/2020/02/Blue-logo-transparent-bg.png?=1200&ssl=1', 'http://millenconstruction.com/', null, 'Facebook: https://www.facebook.com/millenconstruction/', 70),
    ('Services & Trades', 'Paul Melsness Refinishing', 'Refinishing services.', null, '(541) 891-0636', null, '22605 Hwy 70, Bonanza, OR 97623', null, null, null, null, 80),
    ('Services & Trades', 'Duarte Sales', 'Licensed & bonded auctioneer. Sales managed and promoted.', 'Eric Duarte & Nikki Duarte', '(541) 533-2105', null, null, null, 'http://www.duartesales.com', null, 'Fax: (541) 533-3127. Cell: (541) 891-7863. Facebook: https://www.facebook.com/profile.php?id=100057065245352', 90),
    ('Services & Trades', 'Running W Enterprises', 'Cattle & hay sales, security, Oregon notary, and certified firearms instruction.', null, '(541) 944-3835', 'runningwenterprises@gmail.com', 'P.O. Box 442, Bly, OR 97622', '/assets/RunningWEnterpriseslogo.png', null, null, 'Fax: (541) 353-2629', 100),

    ('Health & Wellness', 'Bly Beauties', 'Community group (Ladies over 50).', null, '(530) 249-4173', null, null, null, null, null, null, 10),
    ('Health & Wellness', 'Klamath Hospice and Palliative Care', 'Your care is our mission.', null, '(541) 882-2902', null, null, null, 'https://www.klamathhospice.org', null, 'Website label on old page: klamathhospice.org', 20),
    ('Health & Wellness', 'The Bonanza Clinic', 'Primary care clinic.', 'Michael A. Sheets, FNP', '(541) 545-1820', null, '31863 Hwy 70, Bonanza, OR 97623', null, null, 'Mon-Fri, 2-6 pm', 'Original label: Provider: Michael A. Sheets, FNP', 30),

    ('Lodging', 'Aspen Ridge Resort', 'A family-owned guest ranch and resort on a century-old working cattle ranch, offering rustic lodging in handcrafted log cabins and lodge rooms, hearty dining, and ranch-style recreation (horseback riding, fishing, hiking, and more).', null, '(541) 884-8685', null, 'Mile Marker 18 Fishhole Creek Rd, Bly, OR 97622', '/assets/AspenRidgeresortImage.gif', 'https://www.aspenrr.com/', null, 'Website label on old page: aspenrr.com', 10),
    ('Lodging', 'The Barn at Marvin Garden', 'Peaceful off-the-beaten-path stay with original post-and-beam craftsmanship, open rafters, and a chef-ready kitchen. Steps to the OC&E Trail, a private patio with Gearhart Mountain views, and easy access to the Bread Wagon, Aspen Ridge, and the Cowboy Dinner Tree.', 'Sheila Mckelvie', '(541) 771-8382', null, null, '/assets/TheBarnatMarvinGarden.avif', 'https://www.airbnb.com/rooms/1224719521013161560?guests=1&adults=1&s=67&unique_share_id=24677418-1c9e-408d-8dbd-7241ca74623c', null, 'Space: 2 bedrooms, 2 queen beds, 1 bathroom. Amenities: On-demand hot water, infrared sauna, Starlink internet. Guest access: Whole property.', 20),
    ('Lodging', 'Cornell Rental', 'Private rental with a full kitchen.', 'Suzanne', null, null, '19019 Waldeck Street, Bly, OR 97622', '/assets/CornellRental.jpg', null, null, 'Space: 1 double bed, 1 pull-out couch. Rate: $80 per night.', 30),
    ('Lodging', 'Lone Pine Trailer Park', 'Overnighters welcome.', 'Donna Kness', '(541) 591-0035', null, null, null, null, null, null, 40),

    ('Education', 'Gearhart Elementary School', 'Public elementary school serving the Bly area.', null, '(541) 353-2417', 'nixonm@kcsd.k12.or.us', '61100 Metler St, Bly, OR 97622', 'https://www.kcsd.k12.or.us/custom/schools/gearhart/general/asset_logo.svg', 'https://www.kcsd.k12.or.us/schools/gearhart/', null, 'Website label on old page: kcsd.k12.or.us. Facebook: https://www.facebook.com/profile.php?id=61564219626370', 10),
    ('Education', 'Bly Preschool', 'For 3, 4 & 5 year old students. Monday & Thursday 9:30-11:30.', 'Leda Hunter / Pat Phillips', null, null, null, null, null, 'Monday & Thursday 9:30-11:30', 'Contacts: Leda Hunter - (541) 891-4661. Pat Phillips - (541) 891-0746.', 20),

    ('Faith & Churches', 'Abiding Place Ministries', 'Sunday service 10:30 am & 6:00 pm. Wednesday at 7:00 pm.', 'Daniel / Brad', null, null, '71410 Highway 140 E, Bly, OR 97622', null, null, 'Sunday 10:30 am and 6:00 pm. Wednesday 7:00 pm.', 'Daniel: (619) 890-1921. Brad: (760) 239-1551.', 10),
    ('Faith & Churches', 'Beatty Valley Church', 'Sunday School 10 am, Church 11 am. Wednesday night Bible Study 6 pm.', 'Cindy Bowles', '(541) 591-9825', null, '42726 Walnut St., Beatty, OR 97621', null, null, 'Sunday School 10 am, Church 11 am, Wednesday Bible Study 6 pm', 'Pastor: Cindy Bowles', 20),
    ('Faith & Churches', 'Standing Stone Church', 'Sunday School 9:45 am, Sunday Service 11:00 am, Thursday Bible Study 5:00 pm.', 'David Prantner', '(541) 353-2622', null, null, '/assets/StandingStoneChurchimage.jpg', 'https://www.facebook.com/StandingStoneCMA/', 'Sunday School 9:45 am, Sunday Service 11:00 am, Thursday Bible Study 5:00 pm', 'Website/social: Facebook', 30),
    ('Faith & Churches', 'St. James Catholic Church', 'Mass 11:30 a.m. Holy Days 5:00 p.m. Vigil.', null, null, null, 'Bly, OR', null, null, 'Mass 11:30 a.m. Holy Days 5:00 p.m. Vigil.', 'Original label: City: Bly, OR', 40),

    ('Utilities', 'Bly Water and Sanitation District', 'Local water and sanitation services.', null, '(541) 353-2562', null, '61138 Hwy 140 E, Bly, OR 97622', '/assets/BlyWaterimage.png', 'https://www.blywater.com/', null, 'Emergency: (541) 891-3902. Facebook: https://www.facebook.com/p/Bly-Water-and-Sanitary-District-100079576039064/', 10),

    ('Recreation & Community Space', 'Ruth Obenchain Recreation Center', 'Membership-run community gym with scheduled events. The building is not staffed and the doors stay locked; access is arranged through the website (typically at least a day in advance) for monthly memberships and open gym nights. Rentals are also handled online-call if you have questions.', null, '(541) 904-0428', null, '19140 Edler Street, Bly, OR 97622', '/assets/rorchomeimage.jpg', 'https://ruthobenchainrc.com', null, 'Website label on old page: ruthobenchainrc.com', 10)
) 
insert into public.businesses (
  business_category,
  business_name,
  description,
  contact_name,
  phone,
  business_email,
  address,
  image_url,
  website_url,
  hours,
  notes,
  sort_order,
  status,
  submitted_at,
  published_at,
  updated_at
)
select
  seed.business_category,
  seed.business_name,
  seed.description,
  seed.contact_name,
  seed.phone,
  seed.business_email,
  seed.address,
  seed.image_url,
  seed.website_url,
  seed.hours,
  seed.notes,
  seed.sort_order,
  'published',
  now(),
  now(),
  now()
from seed
where not exists (
  select 1
  from public.businesses existing
  where existing.business_name = seed.business_name
    and existing.business_category = seed.business_category
);
