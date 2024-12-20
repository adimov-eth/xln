import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { UserService } from '../services/UserService';
import { Logger } from '../utils/Logger';
import { UserRole, UserStatus } from '@xln/types';

describe('User Service Tests', () => {
  let userService: UserService;

  beforeEach(async () => {
    userService = new UserService({
      dbPath: ':memory:',
      logger: new Logger({ name: 'user-test' }),
      jwtSecret: 'test-secret',
    });
    await userService.initialize();
  });

  afterEach(async () => {
    await userService.close();
  });

  describe('Registration', () => {
    it('should register a new user', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Test123!@#',
        profile: {
          displayName: 'Test User',
          firstName: 'Test',
          lastName: 'User',
        },
        settings: {
          emailNotifications: true,
          theme: 'light' as const,
          timezone: 'UTC',
        },
      };

      const user = await userService.register(userData);

      expect(user).to.have.property('id');
      expect(user.email).to.equal(userData.email);
      expect(user.role).to.equal(UserRole.USER);
      expect(user.status).to.equal(UserStatus.PENDING);
      expect(user.profile.displayName).to.equal(userData.profile.displayName);
      expect(user.settings.theme).to.equal(userData.settings.theme);
    });

    it('should not register user with existing email', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Test123!@#',
      };

      await userService.register(userData);

      try {
        await userService.register(userData);
        expect.fail('Should not register duplicate email');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal('Email already registered');
      }
    });
  });

  describe('Authentication', () => {
    it('should login user with correct credentials', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Test123!@#',
      };

      await userService.register(userData);

      const { user, token } = await userService.login({
        email: userData.email,
        password: userData.password,
      });

      expect(user.email).to.equal(userData.email);
      expect(token).to.be.a('string');
    });

    it('should not login with incorrect password', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Test123!@#',
      };

      await userService.register(userData);

      try {
        await userService.login({
          email: userData.email,
          password: 'wrong-password',
        });
        expect.fail('Should not login with incorrect password');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal('Invalid credentials');
      }
    });

    it('should verify valid token', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Test123!@#',
      };

      const registeredUser = await userService.register(userData);
      const { token } = await userService.login(userData);

      const decoded = userService.verifyToken(token);
      expect(decoded.userId).to.equal(registeredUser.id);
    });
  });

  describe('Profile Management', () => {
    it('should update user profile', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Test123!@#',
      };

      const user = await userService.register(userData);

      const updatedUser = await userService.updateProfile(user.id, {
        displayName: 'Updated Name',
        firstName: 'Updated',
        lastName: 'Name',
      });

      expect(updatedUser.profile.displayName).to.equal('Updated Name');
      expect(updatedUser.profile.firstName).to.equal('Updated');
      expect(updatedUser.profile.lastName).to.equal('Name');
    });

    it('should update user settings', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Test123!@#',
      };

      const user = await userService.register(userData);

      const updatedUser = await userService.updateSettings(user.id, {
        theme: 'dark',
        emailNotifications: false,
        timezone: 'America/New_York',
      });

      expect(updatedUser.settings.theme).to.equal('dark');
      expect(updatedUser.settings.emailNotifications).to.equal(false);
      expect(updatedUser.settings.timezone).to.equal('America/New_York');
    });
  });

  describe('Password Management', () => {
    it('should change password', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Test123!@#',
      };

      const user = await userService.register(userData);

      await userService.changePassword(user.id, {
        currentPassword: userData.password,
        newPassword: 'NewTest123!@#',
      });

      const { token } = await userService.login({
        email: userData.email,
        password: 'NewTest123!@#',
      });

      expect(token).to.be.a('string');
    });

    it('should handle password reset flow', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'Test123!@#',
      };

      await userService.register(userData);

      const resetToken = await userService.requestPasswordReset({
        email: userData.email,
      });

      await userService.resetPassword({
        token: resetToken,
        newPassword: 'NewTest123!@#',
      });

      const { token } = await userService.login({
        email: userData.email,
        password: 'NewTest123!@#',
      });

      expect(token).to.be.a('string');
    });
  });
}); 