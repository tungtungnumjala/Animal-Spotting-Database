import * as argon2 from 'argon2';

export async function hashPassWord(password: string): Promise<string> {
    return argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
    });
}

export async function verifyPassword(
    hashedPassword: string,
    password: string,
): Promise<boolean> {
    return argon2.verify(hashedPassword, password);
}
