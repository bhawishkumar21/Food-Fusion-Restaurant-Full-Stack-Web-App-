-- Demo tenant + menu. IDs match web/src/lib/demo-data.ts so the frontend's
-- offline demo mode and a seeded database line up.

insert into public.tenants (id, name, slug, plan) values
  ('f00df051-0000-4000-8000-000000000001', 'Food Fusion — Downtown', 'food-fusion-downtown', 'enterprise')
on conflict (id) do nothing;

insert into public.menu_items
  (id, tenant_id, name, description, price_cents, image_url, tags, voice_notes, sort_order)
values
  ('f00d0000-0000-4000-8000-000000000001', 'f00df051-0000-4000-8000-000000000001',
   'Saffron Butter Salmon', 'Line-caught salmon, saffron beurre blanc, charred broccolini.', 2800,
   'https://images.unsplash.com/photo-1467003909585-2f8a72700288', '{high_protein,chef_special}',
   'Contains dairy and fish. 42g protein. Pairs with the citrus spritz.', 1),
  ('f00d0000-0000-4000-8000-000000000002', 'f00df051-0000-4000-8000-000000000001',
   'Hickory Smoked Ribs', '14-hour smoked pork ribs, black-garlic glaze, pickled slaw.', 3200,
   'https://images.unsplash.com/photo-1544025162-d76694265947', '{high_protein,chef_special}',
   'Chef''s signature. Gluten-free. 55g protein. Shareable for two.', 2),
  ('f00d0000-0000-4000-8000-000000000003', 'f00df051-0000-4000-8000-000000000001',
   'Ember Pork Chop', 'Bone-in chop, roasted apple, crispy potatoes, sage jus.', 2600,
   'https://images.unsplash.com/photo-1432139555190-58524dae6a55', '{high_protein}',
   '48g protein. Cooked medium unless asked otherwise.', 3),
  ('f00d0000-0000-4000-8000-000000000004', 'f00df051-0000-4000-8000-000000000001',
   'Rainbow Buddha Bowl', 'Avocado, chickpeas, roasted squash, greens, tahini drizzle.', 1600,
   'https://images.unsplash.com/photo-1512621776951-a57141f2eefd', '{vegan,quick_bite}',
   'Fully vegan, nut-free. Ready in about 6 minutes.', 4),
  ('f00d0000-0000-4000-8000-000000000005', 'f00df051-0000-4000-8000-000000000001',
   'Garden Farfalle', 'Bow-tie pasta, blistered tomatoes, basil pesto (dairy-free).', 1800,
   'https://images.unsplash.com/photo-1473093295043-cdd812d0e601', '{vegan}',
   'Vegan. Contains gluten and pine nuts.', 5),
  ('f00d0000-0000-4000-8000-000000000006', 'f00df051-0000-4000-8000-000000000001',
   'Charred Grain Salad', 'Ancient grains, pickled red onion, herbs, pomegranate.', 1400,
   'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe', '{vegan,quick_bite}',
   'Vegan. Light option, about 420 kcal.', 6),
  ('f00d0000-0000-4000-8000-000000000007', 'f00df051-0000-4000-8000-000000000001',
   'Fusion Smash Burger', 'Double smashed patty, gochujang aioli, aged cheddar, brioche.', 1900,
   'https://images.unsplash.com/photo-1568901346375-23c9450c58cd', '{high_protein,quick_bite}',
   '38g protein. Can be made gluten-free with a lettuce wrap.', 7),
  ('f00d0000-0000-4000-8000-000000000008', 'f00df051-0000-4000-8000-000000000001',
   'Coastal Prawn Curry', 'Tiger prawns, coconut-turmeric curry, jasmine rice.', 2400,
   'https://images.unsplash.com/photo-1559847844-5315695dadae', '{chef_special}',
   'Medium spice. Contains shellfish. Dairy-free.', 8),
  ('f00d0000-0000-4000-8000-000000000009', 'f00df051-0000-4000-8000-000000000001',
   'Chili Prawn Linguine', 'Hand-cut linguine, prawns, Calabrian chili, lemon butter.', 2300,
   'https://images.unsplash.com/photo-1563379926898-05f4575a45d8', '{chef_special}',
   'Spicy. Contains shellfish, gluten and dairy.', 9),
  ('f00d0000-0000-4000-8000-000000000010', 'f00df051-0000-4000-8000-000000000001',
   'Lamb Kofta Bites', 'Spiced lamb kofta, mint yoghurt, charred flatbread.', 1500,
   'https://images.unsplash.com/photo-1529042410759-befb1204b468', '{high_protein,quick_bite}',
   '30g protein. Contains dairy and gluten.', 10),
  ('f00d0000-0000-4000-8000-000000000011', 'f00df051-0000-4000-8000-000000000001',
   'Smoked Chicken Flatbread', 'Wood-fired flatbread, smoked chicken, peppers, mozzarella.', 1700,
   'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38', '{quick_bite}',
   'Great for sharing. Contains gluten and dairy.', 11),
  ('f00d0000-0000-4000-8000-000000000012', 'f00df051-0000-4000-8000-000000000001',
   'Golden Yolk Toast', 'Sourdough, smashed avocado, soft fried egg, chili crisp.', 1100,
   'https://images.unsplash.com/photo-1525351484163-7529414344d8', '{quick_bite}',
   'Vegetarian. Ready in about 5 minutes.', 12)
on conflict (id) do nothing;
