import type { DatabaseSync } from 'node:sqlite';
// Version 1 adopts the existing local schema without dropping user data.
const migrations = [
  {
    version: 1,
    sql: `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free',
      role TEXT NOT NULL DEFAULT 'Creator and buyer', recipients TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artworks (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
      description TEXT NOT NULL, category TEXT NOT NULL, price INTEGER NOT NULL CHECK(price > 0),
      licenses TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published',
      file_name TEXT, original_name TEXT, mime TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0,
      hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL REFERENCES users(id), artwork_id TEXT NOT NULL REFERENCES artworks(id),
      license TEXT NOT NULL, amount INTEGER NOT NULL, commission INTEGER NOT NULL,
      allocations TEXT NOT NULL, package_id TEXT, created_at TEXT NOT NULL,
      UNIQUE(buyer_id, artwork_id, license)
    );
    CREATE TABLE IF NOT EXISTS team (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE,
      UNIQUE(owner_id, email)
    );
    CREATE INDEX IF NOT EXISTS artwork_owner ON artworks(owner_id);
    CREATE INDEX IF NOT EXISTS purchase_buyer ON purchases(buyer_id);
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);

`,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS wallets (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        address TEXT NOT NULL UNIQUE COLLATE NOCASE, linked_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS wallet_challenges (
        nonce TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_hash TEXT NOT NULL, address TEXT NOT NULL, message TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chain_registrations (
        id TEXT PRIMARY KEY, artwork_id TEXT NOT NULL REFERENCES artworks(id),
        user_id TEXT NOT NULL REFERENCES users(id), chain_id INTEGER NOT NULL,
        contract_address TEXT NOT NULL, instance_id TEXT NOT NULL, registrant TEXT NOT NULL,
        file_hash TEXT NOT NULL, terms_hash TEXT NOT NULL, terms_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('prepared','pending','confirmed','failed')),
        tx_hash TEXT, block_number TEXT, registered_at TEXT, error TEXT, created_at TEXT NOT NULL,
        UNIQUE(instance_id, tx_hash)
      );
      CREATE INDEX IF NOT EXISTS chain_artwork ON chain_registrations(artwork_id, created_at);
      CREATE INDEX IF NOT EXISTS wallet_challenge_expiry ON wallet_challenges(expires_at);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS chain_checkouts (
        id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL REFERENCES users(id), buyer_wallet TEXT NOT NULL,
        instance_id TEXT NOT NULL, contract_address TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('prepared','pending','confirmed','failed')),
        expires_at INTEGER NOT NULL, tx_hash TEXT UNIQUE, block_number TEXT, confirmed_at TEXT,
        total_wei TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chain_checkout_items (
        quote_id TEXT PRIMARY KEY, checkout_id TEXT NOT NULL REFERENCES chain_checkouts(id),
        artwork_id TEXT NOT NULL REFERENCES artworks(id), seller_id TEXT NOT NULL REFERENCES users(id),
        title TEXT NOT NULL, license TEXT NOT NULL, seller_wallet TEXT NOT NULL,
        file_hash TEXT NOT NULL, terms_hash TEXT NOT NULL, terms_json TEXT NOT NULL,
        amount INTEGER NOT NULL, commission INTEGER NOT NULL, amount_wei TEXT NOT NULL, fee_wei TEXT NOT NULL,
        fee_bps INTEGER NOT NULL, signature TEXT NOT NULL,
        purchase_id TEXT UNIQUE REFERENCES purchases(id), previous_local_record TEXT
      );
      CREATE INDEX IF NOT EXISTS chain_checkout_buyer ON chain_checkouts(buyer_id, created_at);
      CREATE INDEX IF NOT EXISTS chain_item_artwork ON chain_checkout_items(artwork_id);
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS chain_revenue_splits (
        quote_id TEXT PRIMARY KEY REFERENCES chain_checkout_items(quote_id),
        allocations_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chain_checkout_versions (
        checkout_id TEXT PRIMARY KEY REFERENCES chain_checkouts(id),
        market_version INTEGER NOT NULL CHECK(market_version IN (1,2))
      );
    `,
  },
  {
    version: 5,
    sql: `
      CREATE TABLE IF NOT EXISTS artwork_revenue_settings (
        artwork_id TEXT PRIMARY KEY REFERENCES artworks(id) ON DELETE CASCADE,
        recipients TEXT NOT NULL
      );
      -- Copy previous portfolio shares once. Future defaults cannot change these projects.
      INSERT OR IGNORE INTO artwork_revenue_settings(artwork_id, recipients)
        SELECT a.id, u.recipients FROM artworks a JOIN users u ON u.id=a.owner_id;
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE IF NOT EXISTS platform_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT OR IGNORE INTO platform_meta VALUES('consent_salt','0x'||lower(hex(randomblob(32))));
      CREATE TABLE IF NOT EXISTS email_verifications (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,email TEXT NOT NULL,verified_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS account_tokens (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,email TEXT NOT NULL,purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')),expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS local_mail (id TEXT PRIMARY KEY,email TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS admin_accounts (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,granted_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS subscriptions (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,plan TEXT NOT NULL CHECK(plan IN ('premium','business')),valid_until INTEGER NOT NULL,cancel_at_end INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS subscription_orders (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),buyer_wallet TEXT NOT NULL,account_hash TEXT NOT NULL,plan TEXT NOT NULL,contract_address TEXT NOT NULL,instance_id TEXT NOT NULL,amount_wei TEXT NOT NULL,expires_at INTEGER NOT NULL,expected_until INTEGER NOT NULL,signature TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('prepared','pending','confirmed','failed')),tx_hash TEXT UNIQUE,valid_until INTEGER,error TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS share_versions (id TEXT PRIMARY KEY,artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,fingerprint TEXT NOT NULL,owner_wallet TEXT,recipients_json TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS share_version_art ON share_versions(artwork_id,created_at);
      CREATE TABLE IF NOT EXISTS share_approvals (version_id TEXT NOT NULL REFERENCES share_versions(id) ON DELETE CASCADE,wallet TEXT NOT NULL COLLATE NOCASE,status TEXT NOT NULL CHECK(status IN ('approved','declined')),signature TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(version_id,wallet));
      CREATE TABLE IF NOT EXISTS artwork_reports (id TEXT PRIMARY KEY,artwork_id TEXT NOT NULL REFERENCES artworks(id),reporter_id TEXT NOT NULL REFERENCES users(id),category TEXT NOT NULL,details TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),created_at TEXT NOT NULL,reviewed_by TEXT REFERENCES users(id),review_note TEXT,reviewed_at TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS report_open_unique ON artwork_reports(artwork_id,reporter_id) WHERE status='open';
      CREATE TABLE IF NOT EXISTS artwork_moderation (artwork_id TEXT PRIMARY KEY REFERENCES artworks(id),hidden INTEGER NOT NULL,reason TEXT NOT NULL,updated_by TEXT NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS moderation_actions (id TEXT PRIMARY KEY,artwork_id TEXT NOT NULL REFERENCES artworks(id),actor_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE IF NOT EXISTS wallet_history (
        id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),address TEXT NOT NULL COLLATE NOCASE,
        linked_at TEXT NOT NULL,unlinked_at TEXT,UNIQUE(user_id,address,linked_at)
      );
      CREATE INDEX IF NOT EXISTS wallet_history_address ON wallet_history(address,linked_at);
      INSERT OR IGNORE INTO wallet_history SELECT lower(hex(randomblob(16))),user_id,address,linked_at,NULL FROM wallets;
      CREATE TABLE IF NOT EXISTS product_archive (
        id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),snapshot_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS product_history (
        id TEXT PRIMARY KEY,artwork_id TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES users(id),
        action TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS product_history_art ON product_history(artwork_id,created_at);
      CREATE TABLE IF NOT EXISTS accounting_events (
        id TEXT PRIMARY KEY,source_key TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN ('sale','subscription')),
        currency TEXT NOT NULL CHECK(currency IN ('local_usd','test_eth')),buyer_id TEXT NOT NULL REFERENCES users(id),
        seller_id TEXT REFERENCES users(id),artwork_id TEXT,title TEXT NOT NULL,license TEXT,purchase_id TEXT,
        gross TEXT NOT NULL,fee TEXT NOT NULL,net TEXT NOT NULL,allocations_json TEXT NOT NULL,
        buyer_wallet TEXT,seller_wallet TEXT,transaction_hash TEXT,contract_address TEXT,instance_id TEXT,
        occurred_at TEXT NOT NULL,recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS accounting_buyer ON accounting_events(buyer_id,occurred_at);
      CREATE INDEX IF NOT EXISTS accounting_seller ON accounting_events(seller_id,occurred_at);
      CREATE TABLE IF NOT EXISTS accounting_supersessions (
        local_event_id TEXT PRIMARY KEY REFERENCES accounting_events(id),chain_event_id TEXT NOT NULL REFERENCES accounting_events(id)
      );
      CREATE TABLE IF NOT EXISTS accounting_balance_snapshots (
        id TEXT PRIMARY KEY,instance_id TEXT NOT NULL,block_number TEXT NOT NULL,block_hash TEXT NOT NULL,
        observed_at TEXT NOT NULL,data_json TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS accounting_events_immutable_update BEFORE UPDATE ON accounting_events BEGIN SELECT RAISE(ABORT,'Accounting events are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS accounting_events_immutable_delete BEFORE DELETE ON accounting_events BEGIN SELECT RAISE(ABORT,'Accounting events are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS product_history_immutable_update BEFORE UPDATE ON product_history BEGIN SELECT RAISE(ABORT,'Product history is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS product_history_immutable_delete BEFORE DELETE ON product_history BEGIN SELECT RAISE(ABORT,'Product history is immutable'); END;
    `,
  },
  {
    version: 8,
    sql: `
      CREATE TABLE IF NOT EXISTS promotion_orders (
        id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),artwork_id TEXT NOT NULL,title TEXT NOT NULL,
        buyer_wallet TEXT NOT NULL,project_hash TEXT NOT NULL,contract_address TEXT NOT NULL,instance_id TEXT NOT NULL,
        amount_wei TEXT NOT NULL,expires_at INTEGER NOT NULL,expected_until INTEGER NOT NULL,signature TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('prepared','pending','confirmed','failed')),tx_hash TEXT UNIQUE,
        starts_at INTEGER,valid_until INTEGER,error TEXT,created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS promotion_orders_owner ON promotion_orders(user_id,artwork_id,created_at);
      CREATE TABLE IF NOT EXISTS promotions (
        artwork_id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES promotion_orders(id),
        instance_id TEXT NOT NULL,contract_address TEXT NOT NULL,starts_at INTEGER NOT NULL,valid_until INTEGER NOT NULL
      );
      -- Keep the existing immutable journal intact; service receipts use the same shape.
      CREATE TABLE IF NOT EXISTS promotion_accounting_events (
        id TEXT PRIMARY KEY,source_key TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind='promotion'),
        currency TEXT NOT NULL CHECK(currency='test_eth'),buyer_id TEXT NOT NULL REFERENCES users(id),
        seller_id TEXT REFERENCES users(id),artwork_id TEXT,title TEXT NOT NULL,license TEXT,purchase_id TEXT,
        gross TEXT NOT NULL,fee TEXT NOT NULL,net TEXT NOT NULL,allocations_json TEXT NOT NULL,
        buyer_wallet TEXT,seller_wallet TEXT,transaction_hash TEXT,contract_address TEXT,instance_id TEXT,
        occurred_at TEXT NOT NULL,recorded_at TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS promotion_events_immutable_update BEFORE UPDATE ON promotion_accounting_events BEGIN SELECT RAISE(ABORT,'Accounting events are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS promotion_events_immutable_delete BEFORE DELETE ON promotion_accounting_events BEGIN SELECT RAISE(ABORT,'Accounting events are immutable'); END;
    `,
  },
  {
    version: 9,
    sql: `
      CREATE TABLE IF NOT EXISTS artwork_images (
        id TEXT PRIMARY KEY, artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL, mime TEXT NOT NULL,
        size INTEGER NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS artwork_image_order ON artwork_images(artwork_id,position);
    `,
  },
  {
    version: 10,
    sql: `
      CREATE TABLE IF NOT EXISTS manager_accounts (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,granted_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_identities (provider TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(provider,subject),UNIQUE(provider,user_id));
      CREATE TABLE IF NOT EXISTS oauth_states (state_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,provider TEXT NOT NULL,window_context TEXT,verifier TEXT NOT NULL,link_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS artwork_license_terms (artwork_id TEXT PRIMARY KEY REFERENCES artworks(id) ON DELETE CASCADE,duration_days INTEGER NOT NULL CHECK(duration_days IN (0,30,90,365)));
      CREATE TABLE IF NOT EXISTS chain_license_periods (quote_id TEXT PRIMARY KEY REFERENCES chain_checkout_items(quote_id),duration_seconds INTEGER NOT NULL,valid_from INTEGER,valid_until INTEGER);
      CREATE TABLE IF NOT EXISTS license_validity (purchase_id TEXT PRIMARY KEY REFERENCES purchases(id),valid_from INTEGER NOT NULL,valid_until INTEGER);
      CREATE TABLE IF NOT EXISTS chain_purchase_links (quote_id TEXT PRIMARY KEY REFERENCES chain_checkout_items(quote_id),purchase_id TEXT NOT NULL REFERENCES purchases(id));
      ALTER TABLE chain_checkout_versions RENAME TO chain_checkout_versions_old;
      CREATE TABLE IF NOT EXISTS chain_checkout_versions (checkout_id TEXT PRIMARY KEY REFERENCES chain_checkouts(id),market_version INTEGER NOT NULL CHECK(market_version IN (1,2,3,4)));
      INSERT INTO chain_checkout_versions SELECT * FROM chain_checkout_versions_old;
      DROP TABLE chain_checkout_versions_old;
    `,
  },
  {
    version: 11,
    sql: `
    CREATE TABLE IF NOT EXISTS escrow_records (
      quote_id TEXT PRIMARY KEY REFERENCES chain_checkout_items(quote_id),state TEXT NOT NULL,
      delivery_deadline INTEGER NOT NULL,review_deadline INTEGER NOT NULL DEFAULT 0,dispute_deadline INTEGER NOT NULL DEFAULT 0,
      funding_tx TEXT NOT NULL,funding_block TEXT NOT NULL,release_tx TEXT,refund_tx TEXT,settled_at TEXT,updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS escrow_decisions (id TEXT PRIMARY KEY,quote_id TEXT NOT NULL REFERENCES escrow_records(quote_id),manager_id TEXT NOT NULL REFERENCES users(id),refund INTEGER NOT NULL,reason TEXT NOT NULL,tx_hash TEXT,created_at TEXT NOT NULL);
    ALTER TABLE chain_checkout_versions RENAME TO chain_checkout_versions_old;
    CREATE TABLE chain_checkout_versions (checkout_id TEXT PRIMARY KEY REFERENCES chain_checkouts(id),market_version INTEGER NOT NULL CHECK(market_version IN (1,2,3,4)));
    INSERT INTO chain_checkout_versions SELECT * FROM chain_checkout_versions_old;
    DROP TABLE chain_checkout_versions_old;
  `,
  },
  {
    version: 12,
    sql: `
    CREATE TABLE IF NOT EXISTS privacy_consents (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),version TEXT NOT NULL,source TEXT NOT NULL,accepted_at TEXT NOT NULL,revoked_at TEXT);
    CREATE INDEX IF NOT EXISTS privacy_consents_user ON privacy_consents(user_id,version);
    CREATE TABLE IF NOT EXISTS public_profiles (user_id TEXT PRIMARY KEY REFERENCES users(id),alias TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS privacy_requests (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL,response TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS operating_expenses (id TEXT PRIMARY KEY,manager_id TEXT NOT NULL REFERENCES users(id),category TEXT NOT NULL,amount_cents TEXT NOT NULL,occurred_on TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL,voided_at TEXT,void_reason TEXT);
    CREATE TABLE IF NOT EXISTS artwork_usage_policies (artwork_id TEXT PRIMARY KEY REFERENCES artworks(id) ON DELETE CASCADE,version TEXT NOT NULL);
  `,
  },
];
export function migrate(db: DatabaseSync) {
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number })
    .user_version;
  if (current > migrations.at(-1)!.version)
    throw new Error('This database was created by a newer ArtGuard version.');
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version=${migration.version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
