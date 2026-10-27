-- Unclaimed reference products have no maintained product ID. Return NULL
-- directly instead of running the maintained-product query for each reference.
begin;
alter function app.robot_product_card(uuid) strict;
commit;
