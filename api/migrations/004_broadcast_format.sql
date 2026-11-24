ALTER TABLE tg_broadcasts ADD COLUMN parse_mode TEXT CHECK (parse_mode IS NULL OR parse_mode='HTML');
