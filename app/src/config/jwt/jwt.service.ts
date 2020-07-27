import { ConfigService } from "@nestjs/config";
import {
  JwtModuleOptions,
  JwtOptionsFactory,
  JwtSecretRequestType
} from "@nestjs/jwt";
import { Injectable, Logger } from "@nestjs/common";
import { JWK } from "node-jose";
import { Cron } from "@nestjs/schedule";
import moment from "moment";

@Injectable()
export class JWTConfigService implements JwtOptionsFactory {

  private readonly keystore = JWK.createKeyStore();
  private readonly logger = new Logger(JWTConfigService.name);
  private currentSigningKey: JWK.Key = null;

  constructor (
    private readonly configService: ConfigService
  ) {}

  get publicKeys (): Object {
    return this.keystore.toJSON();
  }

  get lifetime (): number {
    return this.configService.get<number>("TOKEN_EXPIRATION");
  }

  get signingKeyId (): string {
    return this.currentSigningKey.kid;
  }

  async createJwtOptions (): Promise<JwtModuleOptions> {
    const JWTOptions = {
      audience: this.configService.get<string>("TOKEN_AUDIENCE"),
      issuer: this.configService.get<string>("TOKEN_ISSUER")
    };

    await this.handleKeyRotation();
    return {
      secretOrKeyProvider: this.secretOrKeyProvider.bind(this),
      signOptions: {
        expiresIn: this.lifetime,
        ...JWTOptions
      },
      verifyOptions: {
        algorithms: ["ES256", "ES384", "ES512"],
        issuer: JWTOptions.issuer
      }
    };
  }

  @Cron("0 0 1 * *")
  private async handleKeyRotation () {
    const removeFromKeyStore = (key) => this.keystore.remove(key);
    const tokenExpiration = moment.duration(this.lifetime, "seconds");
    const signingKey = await this.keystore.generate("EC", "P-256", {
      use: "sig",
      alg: "ES256"
    });

    this.logger.log("Successfully generated new key pair");
    if (this.currentSigningKey !== null) {
      setTimeout(
        removeFromKeyStore.bind(this),
        tokenExpiration.asMilliseconds(),
        this.currentSigningKey
      );
    }
    this.currentSigningKey = signingKey;
  }

  // TODO: complete implementation with algorithm selection
  private secretOrKeyProvider (requestType: JwtSecretRequestType) {
    switch (requestType) {
      case JwtSecretRequestType.SIGN:
        return this.currentSigningKey.toPEM(true);
      default:
        this.logger.error(`Unknown JWT request type (${requestType})`);
    }
  }
}
