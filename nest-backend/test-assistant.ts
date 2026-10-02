import { AssistantService } from './src/pipeline/assistant.service';

async function main() {
  const assistant = new AssistantService();
  const greet = await assistant.generateReply('السلام عليكم', 'test-session');
  if (!greet.reply.includes('سلام')) {
    throw new Error(`Unexpected greeting reply: ${greet.reply}`);
  }
  const long = assistant.makeVoiceFriendly(
    'هذه جملة أولى. هذه جملة ثانية. هذه جملة ثالثة طويلة جداً يجب ألا تُقال كاملة.',
  );
  if (!long.includes('أولى') || long.includes('ثالثة')) {
    throw new Error(`Voice truncation failed: ${long}`);
  }
  const empty = await assistant.generateReply('   ', 'test-session-2');
  if (empty.reply !== '') {
    throw new Error('Empty speech should not produce a spoken reply');
  }
  console.log('assistant tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
