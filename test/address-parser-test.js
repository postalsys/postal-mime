import test from 'node:test';
import assert from 'node:assert';
import { addressParser } from '../src/postal-mime.js';

// Normal flow tests
test('addressParser - simple email address', () => {
    const result = addressParser('user@example.com');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'user@example.com');
    assert.strictEqual(result[0].name, '');
});

test('addressParser - email with display name in angle brackets', () => {
    const result = addressParser('John Doe <john@example.com>');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'john@example.com');
    assert.strictEqual(result[0].name, 'John Doe');
});

test('addressParser - email with quoted display name', () => {
    const result = addressParser('"Doe, John" <john@example.com>');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'john@example.com');
    assert.strictEqual(result[0].name, 'Doe, John');
});

test('addressParser - multiple addresses separated by comma', () => {
    const result = addressParser('alice@example.com, bob@example.com, charlie@example.com');
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].address, 'alice@example.com');
    assert.strictEqual(result[1].address, 'bob@example.com');
    assert.strictEqual(result[2].address, 'charlie@example.com');
});

test('addressParser - multiple addresses with display names', () => {
    const result = addressParser('Alice Smith <alice@example.com>, Bob Jones <bob@example.com>');
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].address, 'alice@example.com');
    assert.strictEqual(result[0].name, 'Alice Smith');
    assert.strictEqual(result[1].address, 'bob@example.com');
    assert.strictEqual(result[1].name, 'Bob Jones');
});

test('addressParser - address with comment', () => {
    const result = addressParser('john@example.com (John Doe)');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'john@example.com');
    assert.strictEqual(result[0].name, 'John Doe');
});

test('addressParser - address group', () => {
    const result = addressParser('My Group: alice@example.com, bob@example.com;');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'My Group');
    assert.ok(result[0].group);
    assert.strictEqual(result[0].group.length, 2);
    assert.strictEqual(result[0].group[0].address, 'alice@example.com');
    assert.strictEqual(result[0].group[1].address, 'bob@example.com');
});

test('addressParser - empty group', () => {
    const result = addressParser('Empty Group:;');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'Empty Group');
    assert.ok(result[0].group);
    assert.strictEqual(result[0].group.length, 0);
});

test('addressParser - group with display names', () => {
    const result = addressParser('Team: Alice <alice@example.com>, Bob <bob@example.com>;');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'Team');
    assert.strictEqual(result[0].group.length, 2);
    assert.strictEqual(result[0].group[0].name, 'Alice');
    assert.strictEqual(result[0].group[0].address, 'alice@example.com');
    assert.strictEqual(result[0].group[1].name, 'Bob');
    assert.strictEqual(result[0].group[1].address, 'bob@example.com');
});

test('addressParser - MIME encoded-word in display name', () => {
    const result = addressParser('=?utf-8?B?44Ko44Od44K544Kr44O844OJ?= <support@example.com>');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'support@example.com');
    assert.strictEqual(result[0].name, 'エポスカード');
});

test('addressParser - MIME encoded-word in group name', () => {
    const result = addressParser('=?utf-8?B?44OB44O844Og?=: user@example.com;');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'チーム');
    assert.strictEqual(result[0].group[0].address, 'user@example.com');
});

// Edge case tests
test('addressParser - empty string', () => {
    const result = addressParser('');
    assert.strictEqual(result.length, 0);
});

test('addressParser - whitespace only', () => {
    const result = addressParser('   ');
    assert.strictEqual(result.length, 0);
});

test('addressParser - address without domain', () => {
    const result = addressParser('username');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, '');
    assert.strictEqual(result[0].name, 'username');
});

test('addressParser - address with multiple @ symbols', () => {
    const result = addressParser('user@host@example.com');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'user@host@example.com');
});

test('addressParser - display name with special characters', () => {
    const result = addressParser('"O\'Reilly, John (Manager)" <john@example.com>');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'john@example.com');
    assert.strictEqual(result[0].name, "O'Reilly, John (Manager)");
});

test('addressParser - address with + in local part', () => {
    const result = addressParser('user+tag@example.com');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'user+tag@example.com');
});

test('addressParser - address with dots in local part', () => {
    const result = addressParser('first.last@example.com');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'first.last@example.com');
});

test('addressParser - address with subdomain', () => {
    const result = addressParser('user@mail.example.com');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'user@mail.example.com');
});

test('addressParser - address with dashes and underscores', () => {
    const result = addressParser('user_name-test@example-domain.com');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'user_name-test@example-domain.com');
});

test('addressParser - multiple commas between addresses', () => {
    const result = addressParser('alice@example.com,,,bob@example.com');
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].address, 'alice@example.com');
    assert.strictEqual(result[1].address, 'bob@example.com');
});

test('addressParser - mixed semicolons and commas', () => {
    const result = addressParser('alice@example.com; bob@example.com, charlie@example.com');
    assert.strictEqual(result.length, 3);
});

test('addressParser - unclosed angle bracket', () => {
    const result = addressParser('John Doe <john@example.com');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'john@example.com');
});

test('addressParser - unclosed comment', () => {
    const result = addressParser('john@example.com (John Doe');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'john@example.com');
});

test('addressParser - nested comments', () => {
    const result = addressParser('john@example.com (John (Johnny) Doe)');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'john@example.com');
});

test('addressParser - empty angle brackets', () => {
    const result = addressParser('John Doe <>');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'John Doe');
});

test('addressParser - address with IP domain', () => {
    const result = addressParser('user@[192.168.1.1]');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'user@[192.168.1.1]');
});

test('addressParser - display name with escaped quotes', () => {
    const result = addressParser('"John \\"The Boss\\" Doe" <john@example.com>');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'john@example.com');
});

test('addressParser - address with whitespace around angle brackets', () => {
    const result = addressParser('John Doe < john@example.com >');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'john@example.com');
    assert.strictEqual(result[0].name, 'John Doe');
});

test('addressParser - flatten option for groups', () => {
    const result = addressParser('Team: alice@example.com, bob@example.com;', { flatten: true });
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].address, 'alice@example.com');
    assert.strictEqual(result[1].address, 'bob@example.com');
});

test('addressParser - flatten with multiple groups', () => {
    const result = addressParser('Team1: alice@example.com; Team2: bob@example.com;', { flatten: true });
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].address, 'alice@example.com');
    assert.strictEqual(result[1].address, 'bob@example.com');
});

// Security-related tests for quoted strings
test('addressParser - quoted string with @ symbol should not extract as email', () => {
    const result = addressParser('"user@domain" <real@example.com>');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'real@example.com');
    assert.strictEqual(result[0].name, 'user@domain');
});

test('addressParser - quoted local part with @ symbol (RFC 5321)', () => {
    const result = addressParser('"user@host"@example.com');
    assert.strictEqual(result.length, 1);
    // The entire quoted part with @ should be preserved in address
    assert.ok(result[0].address);
});

test('addressParser - display name in quotes containing email-like pattern', () => {
    const result = addressParser('"Contact us at support@help.com" <actual@example.com>');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'actual@example.com');
    assert.strictEqual(result[0].name, 'Contact us at support@help.com');
});

test('addressParser - multiple quoted strings with @ symbols', () => {
    const result = addressParser('"admin@internal" <admin@example.com>, "user@test" <user@example.com>');
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].address, 'admin@example.com');
    assert.strictEqual(result[0].name, 'admin@internal');
    assert.strictEqual(result[1].address, 'user@example.com');
    assert.strictEqual(result[1].name, 'user@test');
});

test('addressParser - quoted string followed by unquoted email', () => {
    const result = addressParser('"Not an email: fake@domain.com" real@example.com');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'real@example.com');
});

test('addressParser - group with quoted member names containing @', () => {
    const result = addressParser('Team: "admin@sys" <admin@example.com>, "user@dev" <user@example.com>;');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].group.length, 2);
    assert.strictEqual(result[0].group[0].address, 'admin@example.com');
    assert.strictEqual(result[0].group[0].name, 'admin@sys');
    assert.strictEqual(result[0].group[1].address, 'user@example.com');
    assert.strictEqual(result[0].group[1].name, 'user@dev');
});

test('addressParser - quoted string with special characters and @', () => {
    const result = addressParser('"<script>alert(@)</script>" <safe@example.com>');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'safe@example.com');
    assert.strictEqual(result[0].name, '<script>alert(@)</script>');
});

test('addressParser - nested group flattening', () => {
    // Even though RFC 5322 doesn't allow nested groups, test that implementation handles it
    const result = addressParser('Outer: Inner: user@example.com;;');
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].group);
    // Should flatten nested groups
    assert.ok(Array.isArray(result[0].group));
});

test('addressParser - email extraction from text without angle brackets', () => {
    const result = addressParser('Contact John at john@example.com for details');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'john@example.com');
});

test('addressParser - no false positives from quoted @ symbols in text extraction', () => {
    const result = addressParser('"Reply to fake@test.com" real@example.com');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'real@example.com');
    // Should NOT extract fake@test.com from quoted string
});

test('addressParser - complex quoted display name with commas and @', () => {
    const result = addressParser('"Smith, Bob (bob@old-domain.com)" <bob@example.com>');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'bob@example.com');
    assert.strictEqual(result[0].name, 'Smith, Bob (bob@old-domain.com)');
});

test('addressParser - mixed quoted and unquoted in group', () => {
    const result = addressParser('Team: "Dev@Internal" <dev@example.com>, prod@example.com;');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].group.length, 2);
    assert.strictEqual(result[0].group[0].address, 'dev@example.com');
    assert.strictEqual(result[0].group[1].address, 'prod@example.com');
});

test('addressParser - consecutive quoted strings', () => {
    const result = addressParser('"First" "Last" <user@example.com>');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'user@example.com');
});

test('addressParser - address with unicode characters', () => {
    const result = addressParser('用户 <user@例え.jp>');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'user@例え.jp');
    assert.strictEqual(result[0].name, '用户');
});

test('addressParser - very long address', () => {
    const longLocal = 'a'.repeat(64);
    const longDomain = 'b'.repeat(63) + '.com';
    const result = addressParser(`${longLocal}@${longDomain}`);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, `${longLocal}@${longDomain}`);
});

test('addressParser - address with trailing comma', () => {
    const result = addressParser('user@example.com,');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'user@example.com');
});

test('addressParser - address with leading comma', () => {
    const result = addressParser(',user@example.com');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].address, 'user@example.com');
});

// DoS protection tests for deeply nested groups
test('addressParser - deeply nested groups should not cause stack overflow', () => {
    // Build a deeply nested group structure that would cause stack overflow without protection
    // e.g., "g0: g1: g2: g3: ... gN: user@example.com;"
    const depth = 3000;
    let parts = [];
    for (let i = 0; i < depth; i++) {
        parts.push(`g${i}:`);
    }
    const maliciousInput = parts.join(' ') + ' user@example.com;';

    // This should NOT throw "Maximum call stack size exceeded"
    // Instead it should return a result (possibly truncated due to depth limit)
    let result;
    assert.doesNotThrow(() => {
        result = addressParser(maliciousInput);
    });

    // Should return some result without crashing
    assert.ok(Array.isArray(result));
});

test('addressParser - nested groups up to safe depth should work correctly', () => {
    // Test a few levels of nesting that should work fine
    const result = addressParser('outer: inner: user@example.com;;');
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].group);
});

test('addressParser - many colons in malicious input should not crash', () => {
    // Another variant of the attack - colons without spaces
    const depth = 5000;
    const maliciousInput = ':'.repeat(depth) + 'user@example.com;';

    assert.doesNotThrow(() => {
        addressParser(maliciousInput);
    });
});

test('addressParser - mixed nested groups and addresses should not crash', () => {
    // Mix of nested groups with valid addresses
    const depth = 1000;
    let parts = [];
    for (let i = 0; i < depth; i++) {
        parts.push(`group${i}:`);
    }
    const maliciousInput = parts.join(' ') + ' victim@example.com; normal@example.com';

    let result;
    assert.doesNotThrow(() => {
        result = addressParser(maliciousInput);
    });
    assert.ok(Array.isArray(result));
});
