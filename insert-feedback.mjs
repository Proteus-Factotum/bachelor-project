import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const episode_id = '6b745e25-fa86-431b-9908-044d8a3ab09b';

const { data, error } = await supabase
  .from('feedback')
  .insert({ episode_id, reward: 1, tag: 'good' })
  .select()
  .single();

if (error) {
  console.error('Insert failed:', error);
  process.exit(1);
}

console.log('Inserted feedback_id:', data.id);
