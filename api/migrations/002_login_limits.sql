CREATE TABLE login_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  expires BIGINT NOT NULL
);
CREATE INDEX login_limits_expiry ON login_limits(expires);
