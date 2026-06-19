const email = '1581060104@qq.com';
const fullKey = 'f4ea362ca2a2c300bda59169-e5253cdf4b5a1cd35a9e143435b7372e992b7305d39e8bcc7fed2b27920b862904c8b9f61d114cfc1081dea977557eb60c3bce029389dc539853095ce125f70e0332856724b11ad16ec15cdfed44a2ae50d7d049056fdc26a1f0d98a8b35dfd46b5703563225';
const cleanKey = fullKey.replace('-', '');

async function testKey(key) {
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/accounts', {
      headers: {
        'X-Auth-Key': key,
        'X-Auth-Email': email
      }
    });
    const json = await res.json();
    return json;
  } catch (err) {
    return { error: err.message };
  }
}

async function testToken(token) {
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/accounts', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const json = await res.json();
    return json;
  } catch (err) {
    return { error: err.message };
  }
}

async function run() {
  console.log('--- Testing Key Substrings (X-Auth-Key) ---');
  for (let len = 32; len <= 45; len++) {
    const sub = cleanKey.substring(0, len);
    const result = await testKey(sub);
    console.log(`CleanKey Length ${len}: success=${result.success}, code=${result.errors?.[0]?.code}, msg=${result.errors?.[0]?.message}`);
    if (result.success) {
      console.log(`FOUND WORKING KEY: ${sub}`);
      return;
    }
  }

  const part2 = fullKey.split('-')[1];
  for (let len = 32; len <= 45; len++) {
    const sub = part2.substring(0, len);
    const result = await testKey(sub);
    console.log(`Part2 Length ${len}: success=${result.success}, code=${result.errors?.[0]?.code}, msg=${result.errors?.[0]?.message}`);
    if (result.success) {
      console.log(`FOUND WORKING KEY IN PART 2: ${sub}`);
      return;
    }
  }

  console.log('\n--- Testing Token Substrings (Bearer Token) ---');
  for (let len = 32; len <= 45; len++) {
    const sub = cleanKey.substring(0, len);
    const result = await testToken(sub);
    console.log(`CleanKey Token Length ${len}: success=${result.success}, code=${result.errors?.[0]?.code}, msg=${result.errors?.[0]?.message}`);
    if (result.success) {
      console.log(`FOUND WORKING TOKEN: ${sub}`);
      return;
    }
  }

  for (let len = 32; len <= 45; len++) {
    const sub = part2.substring(0, len);
    const result = await testToken(sub);
    console.log(`Part2 Token Length ${len}: success=${result.success}, code=${result.errors?.[0]?.code}, msg=${result.errors?.[0]?.message}`);
    if (result.success) {
      console.log(`FOUND WORKING TOKEN IN PART 2: ${sub}`);
      return;
    }
  }
}

run();
