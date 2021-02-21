import {Construct} from '@aws-cdk/core';
import {StateMachine} from '@aws-cdk/aws-stepfunctions';
import {Role, ServicePrincipal} from '@aws-cdk/aws-iam';
import {
    AwsIntegration,
    PassthroughBehavior,
    RestApi
} from '@aws-cdk/aws-apigateway';
import apigw = require('@aws-cdk/aws-apigateway');

export interface ApiToStateMachineProps {
    stateMachine: StateMachine
}

export class ApiToStateMachine extends Construct {
    constructor(scope: Construct, id: string, props: ApiToStateMachineProps) {
        super(scope, id);

        // Create a role for API Gateway
        var apiRole = new Role(this, `${id}Role`, {
            roleName: `${id}Role`,
            assumedBy: new ServicePrincipal('apigateway.amazonaws.com')
        });

        // Grand role permissions to execute api
        props.stateMachine.grantStartExecution(apiRole);

        // Create api with resource 
        const api = new RestApi(this, `${id}RestApi`,{
            description:"API for PostReader Application ",
            defaultCorsPreflightOptions: {
              allowOrigins: apigw.Cors.ALL_ORIGINS,
              allowMethods: apigw.Cors.ALL_METHODS // this is also the default
            }
          });


        var resource = api.root.addResource('reminders');

        // Model for response
        const methodProps = {
            methodResponses: [
                {
                    statusCode: "200",
                    responseParameters: {
                    'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
                {
                    statusCode: "500",
                    responseParameters: {
                    'method.response.header.Access-Control-Allow-Origin': true,
                    },
                }
                ]
        }

        // Putting state machine arn in request transformation and treting body of request as body for state machine
        const requestTemplate = {
            'application/json': JSON.stringify({
                    stateMachineArn: props.stateMachine.stateMachineArn,
                    input: "$util.escapeJavaScript($input.json('$'))"
                }
            )
        }

        // Transformation of response
        const integrationResponse = [
            {
                selectionPattern: '200',
                statusCode: '200',
                // Consider hiding execution ARN for security reasons.
                responseTemplates: {
                    'application/json': "$input.json('$')"
                },
                responseParameters: {
                    // We can map response parameters
                    // - Destination parameters (the key) are the response parameters (used in mappings)
                    // - Source parameters (the value) are the integration response parameters or expressions
                    'method.response.header.Access-Control-Allow-Origin': "'*'"
                }
            }
        ];

        // Defining SF integration
        const integration = new AwsIntegration({
            service: 'states',
            action: 'StartExecution',
            options: {
                credentialsRole: apiRole,
                requestTemplates: requestTemplate,
                passthroughBehavior: PassthroughBehavior.NEVER,
                integrationResponses: integrationResponse
            }
        });
        
        // Add method on which SF will be executed
        resource.addMethod('POST', integration, methodProps);
    }
}