CREATE TABLE config(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL);
CREATE TABLE results(id TEXT PRIMARY KEY,created TEXT NOT NULL,score INTEGER,category TEXT,version INTEGER);
CREATE TABLE admin_meta(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE admins(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT UNIQUE,telegram_id BIGINT UNIQUE,password TEXT,permissions TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,owner INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE admin_sessions(token TEXT PRIMARY KEY,admin_id TEXT NOT NULL,expires BIGINT NOT NULL);
   CREATE INDEX admin_sessions_expires ON admin_sessions(expires);
CREATE TABLE tg_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE tg_users(id BIGINT PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL DEFAULT '',phone TEXT,state TEXT NOT NULL DEFAULT '',pending_result TEXT,active INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL);
   CREATE TABLE tg_claims(result_id TEXT PRIMARY KEY,user_id BIGINT NOT NULL);
   CREATE TABLE tg_orders(id TEXT PRIMARY KEY,user_id BIGINT NOT NULL,kind TEXT NOT NULL,amount INTEGER NOT NULL,status TEXT NOT NULL,address TEXT NOT NULL DEFAULT '',receipt_file TEXT,receipt_kind TEXT,tracking TEXT NOT NULL DEFAULT '',created TEXT NOT NULL,reviewed TEXT);
   CREATE TABLE tg_broadcasts(id TEXT PRIMARY KEY,text TEXT NOT NULL,source_chat BIGINT,source_message BIGINT,kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',created TEXT NOT NULL);
   CREATE TABLE tg_broadcast_media(broadcast_id TEXT PRIMARY KEY,mime TEXT NOT NULL,bytes BYTEA NOT NULL,file_id TEXT);
   CREATE TABLE tg_outbox(id BIGSERIAL PRIMARY KEY,chat_id BIGINT NOT NULL,method TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at BIGINT NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',broadcast_id TEXT,order_id TEXT);
   CREATE INDEX tg_outbox_pending ON tg_outbox(status,next_at);
   CREATE INDEX tg_orders_user ON tg_orders(user_id,created);
   CREATE INDEX tg_claims_user ON tg_claims(user_id);
CREATE FUNCTION protect_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.id='owner' OR OLD.owner=1 THEN RAISE EXCEPTION 'Asosiy adminni olib tashlab bo‘lmaydi.'; END IF;
  RETURN OLD;
 END IF;
 IF (OLD.id='owner' OR OLD.owner=1) AND (NEW.id<>OLD.id OR NEW.owner<>1 OR NEW.active<>1) THEN
  RAISE EXCEPTION 'Asosiy adminning to‘liq huquqlarini cheklab bo‘lmaydi.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_owner_delete BEFORE DELETE ON admins FOR EACH ROW EXECUTE FUNCTION protect_owner();
CREATE TRIGGER protect_owner_update BEFORE UPDATE ON admins FOR EACH ROW EXECUTE FUNCTION protect_owner();
