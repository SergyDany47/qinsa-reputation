-- =============================================================================
-- Qinsa Reputation — Schema completo de Supabase
-- Ejecutado vía MCP de Supabase el 2026-03-05
-- =============================================================================

-- =============================================================================
-- TABLAS
-- =============================================================================

CREATE TABLE IF NOT EXISTS restaurants (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    address         text,
    neighborhood    text,
    city            text DEFAULT 'Madrid',
    category        text,
    google_maps_url text,
    google_rating   numeric(2,1),
    review_count    integer,
    response_rate   numeric(5,2),
    profile_status  text DEFAULT 'prospect'
                    CHECK (profile_status IN ('prospect','visited','lead','client')),
    created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   uuid REFERENCES restaurants(id) ON DELETE CASCADE,
    source          text DEFAULT 'google',
    author_name     text,
    rating          integer CHECK (rating BETWEEN 1 AND 5),
    text            text,
    review_date     date,
    owner_replied   boolean DEFAULT false,
    reply_text      text,
    collected_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS insights (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id    uuid UNIQUE REFERENCES restaurants(id) ON DELETE CASCADE,
    top_problems     jsonb,   -- array de 3 strings
    top_strengths    jsonb,   -- array de 3 strings
    keywords         jsonb,   -- array de 5 strings
    summary          text,
    sentiment_score  numeric(4,2),  -- escala 0 a 10
    response_quality text,
    generated_at     timestamptz DEFAULT now(),
    model_used       text DEFAULT 'google-natural-language'
);

CREATE TABLE IF NOT EXISTS field_visits (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   uuid REFERENCES restaurants(id) ON DELETE CASCADE,
    visit_date      date DEFAULT CURRENT_DATE,
    visited_by      text,
    status          text DEFAULT 'pending'
                    CHECK (status IN ('pending','visited','interested','rejected')),
    owner_met       boolean DEFAULT false,
    demo_shown      boolean DEFAULT false,
    reaction_score  integer CHECK (reaction_score BETWEEN 1 AND 5),
    notes           text,
    follow_up_date  date
);

CREATE TABLE IF NOT EXISTS survey_responses (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id        uuid REFERENCES restaurants(id) ON DELETE CASCADE,
    owner_name           text,
    q1_time_weekly       text,
    q2_tools_used        text,
    q3_google_importance integer CHECK (q3_google_importance BETWEEN 1 AND 5),
    q4_biggest_pain      text,
    q5_willing_to_use    text,
    submitted_at         timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   uuid REFERENCES restaurants(id) ON DELETE CASCADE,
    owner_name      text,
    email           text,
    phone           text,
    plan_interest   text CHECK (plan_interest IN ('basic','growth','undecided')),
    demo_requested  boolean DEFAULT false,
    source          text CHECK (source IN ('field_visit','landing','referral')),
    created_at      timestamptz DEFAULT now(),
    contacted_at    timestamptz
);

-- =============================================================================
-- ÍNDICES (campos más consultados)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_restaurants_status      ON restaurants(profile_status);
CREATE INDEX IF NOT EXISTS idx_reviews_restaurant_id   ON reviews(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_reviews_rating          ON reviews(rating);
CREATE INDEX IF NOT EXISTS idx_reviews_date            ON reviews(review_date DESC);
CREATE INDEX IF NOT EXISTS idx_insights_restaurant_id  ON insights(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_field_visits_restaurant ON field_visits(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_field_visits_status     ON field_visits(status);
CREATE INDEX IF NOT EXISTS idx_leads_restaurant_id     ON leads(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_survey_restaurant_id    ON survey_responses(restaurant_id);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE restaurants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews          ENABLE ROW LEVEL SECURITY;
ALTER TABLE insights         ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_visits     ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads            ENABLE ROW LEVEL SECURITY;

-- anon puede leer restaurantes e insights (demo app pública)
CREATE POLICY anon_select_restaurants
    ON restaurants FOR SELECT TO anon USING (true);

CREATE POLICY anon_select_insights
    ON insights FOR SELECT TO anon USING (true);

-- service_role tiene acceso total (pipeline Python)
CREATE POLICY service_all_restaurants
    ON restaurants FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY service_all_reviews
    ON reviews FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY service_all_insights
    ON insights FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY service_all_field_visits
    ON field_visits FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY service_all_survey_responses
    ON survey_responses FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY service_all_leads
    ON leads FOR ALL TO service_role USING (true) WITH CHECK (true);
