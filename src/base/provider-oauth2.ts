import nanoid from 'nanoid';

import { AccessToken, Common, Interceptors } from '../utils';
import { Provider } from './core/provider';
import { SalteAuthError } from './core/salte-auth-error';

export abstract class OAuth2Provider extends Provider {
  public constructor(config?: OAuth2Provider.Config) {
    super(config);
  }

  public connected() {
    this.required('responseType');
  }

  public async secure(request: Interceptors.XHR.ExtendedXMLHttpRequest | Request): Promise<string | boolean> {
    if (Common.includes(['token'], this.config.responseType)) {
      const accessToken = this.accessToken();
      if (accessToken.expired) {
        return this.$login();
      }

      if (request) {
        if (request instanceof Request) {
          request.headers.set('Authorization', `Bearer ${accessToken.raw}`);
        } else if (request instanceof XMLHttpRequest) {
          request.setRequestHeader('Authorization', `Bearer ${accessToken.raw}`);
        } else {
          throw new SalteAuthError({
            code: 'unknown_request',
            message: `Unknown request type. (${request})`,
          });
        }
      }
    }

    return true;
  }

  protected $validate(options: OAuth2Provider.Validation): void {
    try {
      if (options.error) {
        throw new SalteAuthError({
          code: options.error,
          message: `${options.error_description ? options.error_description : options.error}${options.error_uri ? ` (${options.error_uri})` : ''}`,
        });
      }

      const { code, access_token, state, expires_in, token_type } = options;

      if (this.validation('state') && this.get('state') !== state) {
        throw new SalteAuthError({
          code: 'invalid_state',
          message: 'State provided by identity provider did not match local state.',
        });
      }

      const types = this.get('response-type', '').split(' ');
      if (Common.includes(types, 'code')) {
        if (!code) {
          throw new SalteAuthError({
            code: 'invalid_code',
            message: 'Expected a code to be returned by the Provider.',
          });
        }
      } else if (Common.includes(types, 'token')) {
        if (!access_token) {
          throw new SalteAuthError({
            code: 'invalid_access_token',
            message: 'Expected an access token to be returned by the Provider.',
          });
        }
      }

      if (code) {
        this.set('code.raw', code);
        this.clear('access-token.raw');
        this.clear('access-token.expiration');
        this.clear('access-token.type');
      } else if (access_token) {
        this.set('access-token.raw', access_token);
        this.set('access-token.expiration', Date.now() + (Number(expires_in) * 1000));
        this.set('access-token.type', token_type);
        this.clear('code.raw');
      }
    } finally {
      this.clear('state');
    }
  }

  public validate(options: OAuth2Provider.Validation) {
    try {
      this.$validate(options);
    } catch (error) {
      this.emit('login', error);
      throw error;
    }

    this.emit('login', null, this.code || this.accessToken());
  }

  public accessToken(): AccessToken {
    const expiration = this.get('access-token.expiration');

    return new AccessToken(
      this.get('access-token.raw'),
      Common.includes([undefined, null], expiration) ? null : Number(expiration),
      this.get('access-token.type')
    );
  }

  public get code() {
    return this.get('code.raw');
  }

  public $login(options: OAuth2Provider.OverrideOptions = {}): string {
    const state = `${this.$name}-state-${nanoid()}`;
    const responseType = options.responseType || this.config.responseType;

    this.set('state', state);
    this.set('response-type', responseType);

    return this.url(this.login, {
      client_id: this.config.clientID,
      response_type: responseType,
      redirect_uri: this.config.redirectUrl,
      scope: this.config.scope,
      state
    });
  }

  public get logout(): string {
    throw new SalteAuthError({
      code: 'logout_not_supported',
      message: `OAuth 2.0 doesn't support logout!`,
    });
  }
}

export interface OAuth2Provider {
  config: OAuth2Provider.Config;

  on(name: 'login', listener: (error?: Error, accessToken?: AccessToken) => void): void;
  on(name: 'login', listener: (error?: Error, code?: string) => void): void;
  on(name: 'logout', listener: (error?: Error) => void): void;
}

export declare namespace OAuth2Provider {
  export interface Config extends Provider.Config {
    /**
     * Determines whether a authorization code (server) or access token (client) should be returned.
     * @type {('code'|'token')}
     */
    responseType?: string;

    /**
     * A list of space-delimited claims used to determine what user information is provided and what access is given.
     */
    scope?: string;

    /**
     * The client id of your identity provider
     */
    clientID: string;

    validation?: boolean | ValidationOptions;
  }

  export interface OverrideOptions extends Provider.OverrideOptions {
    /**
     * Determines whether a authorization code (server) or access token (client) should be returned.
     * @type {('code'|'token')}
     */
    responseType?: string;
  }

  export interface ValidationOptions extends Provider.ValidationOptions {
    /**
     * Disables cross-site forgery validation via "state".
     */
    state: boolean;
  }

  export interface Validation {
    /**
     * An error code sent from the Provider
     */
    error: ('unauthorized_client'|'access_denied'|'unsupported_response_type'|'invalid_scope'|'server_error'|'temporarily_unavailable');

    /**
     * Human-readable message sent back by the Provider.
     */
    error_description?: string;

    /**
     * A URI to a human-readable web page with information about the error.
     */
    error_uri?: string;

    /**
     * A value sent back by the server to the client.
     *
     * Used to prevent cross-site request forgery.
     */
    state: string;

    /**
     * The authorization code generated by the Provider.
     *
     * Generally used by a backend server to generate an access token.
     */
    code: string;

    /**
     * The access token issued by the Provider.
     */
    access_token: string;

    /**
     * The type of the token issued.
     */
    token_type: ('bearer'|'mac');

    /**
     * The lifetime (in seconds) of the access_token.
     *
     * For example, the value "3600" denotes that the access token will
     * expire in one hour from the time the response was generated.
     */
    expires_in: string;
  }
}